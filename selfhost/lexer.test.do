import { Assert } from "std/assert"
import { Lexer, TokenType, tokenValue } from "./lexer"

function types(source: string): TokenType[] {
  return Lexer { source }.tokenize().map(=> it.kind)
}

function assertTypes(actual: TokenType[], expected: TokenType[]): void {
  Assert.equal(actual.length, expected.length)
  for i of 0..<expected.length { Assert.equal(actual[i], expected[i]) }
}

readonly LARGE_SOURCE_BLOCK = "export class Point {\n  x, y: float\n  function display(): string {\n    return `Point: \${x}, \${y}`\n  }\n}\n\nfunction compute(value: int): int {\n  if value <= 0 { return 0 }\n  return (value * 2 + 1) ** 2\n}\n\n// operators, comments, literals, and keywords\n"

export function testHotPathTokens(): void {
  actual := types("let value := 42 + 3.5f // comment\nvalue")
  expected := [TokenType.Let, TokenType.Identifier, TokenType.ColonEqual,
    TokenType.IntLiteral, TokenType.Plus, TokenType.FloatLiteral,
    TokenType.Identifier, TokenType.EndOfFile]
  assertTypes(actual, expected)
}

export function testKeywordsAndOperators(): void {
  actual := types("function try! a() -> int { return a != 0 && true }")
  expected := [TokenType.Function, TokenType.Identifier, TokenType.Identifier,
    TokenType.LeftParen, TokenType.RightParen, TokenType.RightArrow,
    TokenType.Identifier, TokenType.LeftBrace, TokenType.Return,
    TokenType.Identifier, TokenType.BangEqual, TokenType.IntLiteral,
    TokenType.AmpersandAmpersand, TokenType.True, TokenType.RightBrace,
    TokenType.EndOfFile]
  assertTypes(actual, expected)
}

export function testAllKeywords(): void {
  actual := types("const readonly let function return yield if else then while for of break continue case class struct interface implements enum type import export from as true false null void try catch static this weak destructor async retire isolated private with mock")
  expected := [TokenType.Const, TokenType.Readonly, TokenType.Let, TokenType.Function,
    TokenType.Return, TokenType.Yield, TokenType.If, TokenType.Else, TokenType.Then,
    TokenType.While, TokenType.For, TokenType.Of, TokenType.Break, TokenType.Continue,
    TokenType.Case, TokenType.Class, TokenType.Struct, TokenType.Interface,
    TokenType.Implements, TokenType.Enum, TokenType.Type, TokenType.Import,
    TokenType.Export, TokenType.From, TokenType.As, TokenType.True, TokenType.False,
    TokenType.Null, TokenType.Void, TokenType.Try, TokenType.Catch, TokenType.Static,
    TokenType.This, TokenType.Weak, TokenType.Destructor, TokenType.Async,
    TokenType.Retire, TokenType.Isolated, TokenType.Private, TokenType.With,
    TokenType.Mock, TokenType.EndOfFile]
  assertTypes(actual, expected)
}

export function testNumericFormsAndSeparators(): void {
  lexer := Lexer { source: "0xFF_FF 0b1010_0001 42L 3.14 3.14f 30__000" }
  tokens := lexer.tokenize()
  Assert.equal(tokenValue(tokens[0], lexer.source), "0xFFFF")
  Assert.equal(tokenValue(tokens[1], lexer.source), "0b10100001")
  Assert.equal(tokens[2].kind, TokenType.LongLiteral)
  Assert.equal(tokens[3].kind, TokenType.DoubleLiteral)
  Assert.equal(tokens[4].kind, TokenType.FloatLiteral)
  Assert.equal(lexer.diagnostics.length, 1)
}

export function testLargeSourceCorpus(): void {
  source := LARGE_SOURCE_BLOCK.repeat(128)
  tokens := Lexer { source }.tokenize()
  Assert.equal(source.length, 31872)
  Assert.equal(tokens.length, 6785)
  Assert.equal(tokens[tokens.length - 1].kind, TokenType.EndOfFile)
}

export function testPositionsAndValues(): void {
  source := "let\n  x = 30_000"
  tokens := Lexer { source }.tokenize()
  Assert.equal(tokens[0].line, 1)
  Assert.equal(tokens[1].line, 2)
  Assert.equal(tokens[1].column, 3)
  Assert.equal(tokenValue(tokens[3], source), "30000")
  Assert.equal(tokens[3].offset, 10)
}

export function testLexesCallerIntrinsicAsOneToken(): void {
  source := "source: SourceLocation = @caller,"
  tokens := Lexer { source }.tokenize()
  Assert.equal(tokens[4].kind, TokenType.CallerIntrinsic)
  Assert.equal(tokens[4].line, 1)
  Assert.equal(tokens[4].column, 26)
  Assert.equal(tokenValue(tokens[5], source), ",", "token=" + tokenValue(tokens[5], source))
  Assert.equal(tokens[5].kind, TokenType.Comma)
}

export function testInterpolationAndComments(): void {
  source := "`hello \${name}!`"
  tokens := Lexer { source }.tokenize()
  Assert.equal(tokens[0].kind, TokenType.TemplateLiteralStart)
  Assert.equal(tokens[1].kind, TokenType.Identifier)
  Assert.equal(tokens[2].kind, TokenType.TemplateLiteralEnd)
  Assert.equal(tokenValue(tokens[2], source), "!")
  Assert.equal(tokens[3].kind, TokenType.EndOfFile)
}

export function testMultipleInterpolations(): void {
  tokens := Lexer { source: "\"\${first} and \${second}\"" }.tokenize()
  Assert.equal(tokens.length, 6)
  Assert.equal(tokens[0].kind, TokenType.TemplateLiteralStart)
  Assert.equal(tokens[1].kind, TokenType.Identifier)
  Assert.equal(tokens[2].kind, TokenType.TemplateLiteralMiddle)
  Assert.equal(tokens[3].kind, TokenType.Identifier)
  Assert.equal(tokens[4].kind, TokenType.TemplateLiteralEnd)
  Assert.equal(tokens[5].kind, TokenType.EndOfFile)
}

export function testDiagnostics(): void {
  lexer := Lexer { source: "/* never ends" }
  lexer.tokenize()
  Assert.equal(lexer.diagnostics.length, 1)
  Assert.equal(lexer.diagnostics[0].message, "Unterminated block comment")
}
