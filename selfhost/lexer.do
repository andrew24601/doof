// A performance-oriented lexer written in Doof.
//
// The scanner keeps the source immutable and advances one cursor through it.
// Tokens are structs so an array of tokens stays a value array in generated
// C++. Tokens keep source spans instead of eagerly copying their text; callers
// can materialize a value with tokenValue only when a parser needs it.

export enum TokenType {
  IntLiteral,
  LongLiteral,
  FloatLiteral,
  DoubleLiteral,
  StringLiteral,
  CharLiteral,
  TemplateLiteralStart,
  TemplateLiteralMiddle,
  TemplateLiteralEnd,
  Identifier,
  CallerIntrinsic,
  Const,
  Readonly,
  Let,
  Function,
  Return,
  Yield,
  If,
  Else,
  Then,
  While,
  For,
  Of,
  Break,
  Continue,
  Case,
  Class,
  Struct,
  Interface,
  Implements,
  Enum,
  Type,
  Import,
  Export,
  From,
  As,
  True,
  False,
  Null,
  Void,
  Try,
  Catch,
  Static,
  This,
  Weak,
  Destructor,
  Async,
  Retire,
  Isolated,
  Private,
  With,
  Mock,
  Plus,
  Minus,
  Star,
  Slash,
  Backslash,
  Percent,
  StarStar,
  Ampersand,
  Pipe,
  Caret,
  Tilde,
  LessLess,
  GreaterGreater,
  GreaterGreaterGreater,
  AmpersandAmpersand,
  PipePipe,
  Bang,
  QuestionQuestion,
  EqualEqual,
  BangEqual,
  Less,
  LessEqual,
  Greater,
  GreaterEqual,
  Equal,
  ColonEqual,
  LeftArrow,
  PlusEqual,
  MinusEqual,
  StarEqual,
  SlashEqual,
  BackslashEqual,
  PercentEqual,
  StarStarEqual,
  AmpersandEqual,
  PipeEqual,
  CaretEqual,
  LessLessEqual,
  GreaterGreaterEqual,
  QuestionQuestionEqual,
  LeftParen,
  RightParen,
  LeftBrace,
  RightBrace,
  LeftBracket,
  RightBracket,
  Dot,
  DotDot,
  DotDotLess,
  Comma,
  Colon,
  DoubleColon,
  Semicolon,
  RightArrow,
  Arrow,
  QuestionDot,
  BangDot,
  QuestionBracket,
  Underscore,
  DollarBrace,
  Ellipsis,
  EndOfFile,
}

export struct Token {
  readonly kind: TokenType
  readonly length: int
  readonly valueOffset: int
  readonly valueLength: int
  readonly needsDecode: bool
  readonly line: int
  readonly column: int
  readonly offset: int
}

export struct LexerDiagnostic {
  readonly severity: string
  readonly message: string
  readonly line: int
  readonly column: int
}

function decodeEscapeCharacter(escaped: char): string {
  if escaped == 'n' { return "\n" }
  if escaped == 't' { return "\t" }
  if escaped == 'r' { return "\r" }
  if escaped == '\\' { return "\\" }
  if escaped == '"' { return "\"" }
  if escaped == '\'' { return "'" }
  if escaped == '`' { return "`" }
  if escaped == '$' { return "$" }
  if escaped == '0' { return "\0" }
  return string(escaped)
}

export function tokenValue(token: Token, source: string): string {
  raw := source.substring(token.valueOffset, token.valueOffset + token.valueLength)
  if token.kind == TokenType.IntLiteral
      || token.kind == TokenType.LongLiteral
      || token.kind == TokenType.FloatLiteral
      || token.kind == TokenType.DoubleLiteral {
    if raw.contains("_") { return raw.replaceAll("_", "") }
    return raw
  }
  if !token.needsDecode { return raw }

  let value = ""
  let index = 0
  while index < raw.length {
    if raw[index] == '\\' && index + 1 < raw.length {
      index = index + 1
      value = value + decodeEscapeCharacter(raw[index])
    } else {
      value = value + string(raw[index])
    }
    index = index + 1
  }
  return value
}

function keywordType(word: string): TokenType {
  // Length partitioning avoids comparing every identifier against every
  // keyword. This is faster than allocating a map for a few dozen constants.
  if word.length == 2 {
    if word == "if" { return TokenType.If }
    if word == "of" { return TokenType.Of }
    if word == "as" { return TokenType.As }
  } else if word.length == 3 {
    if word == "let" { return TokenType.Let }
    if word == "for" { return TokenType.For }
    if word == "try" { return TokenType.Try }
  } else if word.length == 4 {
    if word == "else" { return TokenType.Else }
    if word == "then" { return TokenType.Then }
    if word == "case" { return TokenType.Case }
    if word == "type" { return TokenType.Type }
    if word == "enum" { return TokenType.Enum }
    if word == "from" { return TokenType.From }
    if word == "true" { return TokenType.True }
    if word == "null" { return TokenType.Null }
    if word == "void" { return TokenType.Void }
    if word == "this" { return TokenType.This }
    if word == "weak" { return TokenType.Weak }
    if word == "with" { return TokenType.With }
    if word == "mock" { return TokenType.Mock }
  } else if word.length == 5 {
    if word == "const" { return TokenType.Const }
    if word == "yield" { return TokenType.Yield }
    if word == "while" { return TokenType.While }
    if word == "break" { return TokenType.Break }
    if word == "class" { return TokenType.Class }
    if word == "false" { return TokenType.False }
    if word == "catch" { return TokenType.Catch }
    if word == "async" { return TokenType.Async }
  } else if word.length == 6 {
    if word == "return" { return TokenType.Return }
    if word == "struct" { return TokenType.Struct }
    if word == "import" { return TokenType.Import }
    if word == "export" { return TokenType.Export }
    if word == "static" { return TokenType.Static }
    if word == "retire" { return TokenType.Retire }
  } else if word.length == 7 {
    if word == "private" { return TokenType.Private }
  } else if word.length == 8 {
    if word == "readonly" { return TokenType.Readonly }
    if word == "function" { return TokenType.Function }
    if word == "continue" { return TokenType.Continue }
    if word == "isolated" { return TokenType.Isolated }
  } else if word.length == 9 {
    if word == "interface" { return TokenType.Interface }
  } else if word.length == 10 {
    if word == "implements" { return TokenType.Implements }
    if word == "destructor" { return TokenType.Destructor }
  }
  return TokenType.Identifier
}

export class Lexer {
  readonly source: string
  pos: int = 0
  line: int = 1
  column: int = 1
  tokens: Token[] = []
  diagnostics: LexerDiagnostic[] = []
  templateDelimiters: char[] = []
  braceDepth: int[] = []

  function tokenize(): Token[] {
    // Reserve a conservative token estimate before the scan. Doof arrays map
    // to shared vector storage, so this avoids repeated vector growth/moves on
    // large source files while preserving the normal dynamic semantics.
    tokens.reserve(source.length \ 2 + 16)
    while pos < source.length {
      skipWhitespaceAndComments()
      if pos >= source.length { break }

      if templateDelimiters.length > 0 && peek() == '}' && braceDepth[braceDepth.length - 1] == 0 {
        advance()
        ignoredBrace := try! braceDepth.pop()
        readTemplateContinuation()
        continue
      }

      ch := peek()
      if ch == '"' || ch == '`' {
        readQuoted(ch)
      } else if ch == '\'' {
        readChar()
      } else if isDigit(ch) {
        readNumber()
      } else if isIdentStart(ch) {
        readIdentifier()
      } else {
        readOperatorOrPunctuation()
      }
    }

    addToken(TokenType.EndOfFile, pos, 0, pos, 0, false, line, column)
    return tokens
  }

  private function peek(offset: int = 0): char {
    if pos + offset >= source.length { return '\0' }
    return source[pos + offset]
  }

  private function advance(): char {
    ch := source[pos]
    pos = pos + 1
    if ch == '\n' {
      line = line + 1
      column = 1
    } else {
      column = column + 1
    }
    return ch
  }

  private function addToken(kind: TokenType, tokenOffset: int, tokenLength: int, valueOffset: int, valueLength: int, needsDecode: bool, tokenLine: int, tokenColumn: int): void {
    tokens.push(Token { kind, length: tokenLength, valueOffset, valueLength, needsDecode, line: tokenLine, column: tokenColumn, offset: tokenOffset })
  }

  private function diagnostic(message: string, diagnosticLine: int, diagnosticColumn: int): void {
    diagnostics.push(LexerDiagnostic {
      severity: "error",
      message,
      line: diagnosticLine,
      column: diagnosticColumn,
    })
  }

  private function skipWhitespaceAndComments(): void {
    while pos < source.length {
      ch := peek()
      if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
        advance()
      } else if ch == '/' && peek(1) == '/' {
        while pos < source.length && peek() != '\n' { advance() }
      } else if ch == '/' && peek(1) == '*' {
        commentLine := line
        commentColumn := column
        advance()
        advance()
        let terminated = false
        while pos < source.length {
          if peek() == '*' && peek(1) == '/' {
            advance()
            advance()
            terminated = true
            break
          }
          advance()
        }
        if !terminated {
          diagnostic("Unterminated block comment", commentLine, commentColumn)
        }
      } else {
        break
      }
    }
  }

  private function isDigit(ch: char): bool {
    return ch >= '0' && ch <= '9'
  }

  private function isHexDigit(ch: char): bool {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
  }

  private function isBaseDigit(ch: char, base: int): bool {
    if base == 10 { return isDigit(ch) }
    if base == 16 { return isHexDigit(ch) }
    return ch == '0' || ch == '1'
  }

  private function isIdentStart(ch: char): bool {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_'
  }

  private function isIdentPart(ch: char): bool {
    return isIdentStart(ch) || isDigit(ch)
  }

  private function readDigits(base: int): void {
    let sawDigit = false

    while pos < source.length {
      ch := peek()
      if isBaseDigit(ch, base) {
        advance()
        sawDigit = true
      } else if ch == '_' {
        if sawDigit && isBaseDigit(peek(1), base) {
          advance()
        } else {
          separatorLine := line
          separatorColumn := column
          while peek() == '_' { advance() }
          diagnostic("Numeric separators must appear between digits", separatorLine, separatorColumn)
        }
      } else {
        break
      }
    }

  }

  private function readNumber(): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    if peek() == '0' && (peek(1) == 'x' || peek(1) == 'X') {
      advance()
      advance()
      readDigits(16)
      readNumericSuffix(start, pos, tokenLine, tokenColumn)
      return
    }
    if peek() == '0' && (peek(1) == 'b' || peek(1) == 'B') {
      advance()
      advance()
      readDigits(2)
      readNumericSuffix(start, pos, tokenLine, tokenColumn)
      return
    }

    readDigits(10)
    if peek() == '.' && peek(1) != '.' && peek(1) != '<' {
      advance()
      readDigits(10)
      valueEnd := pos
      if peek() == 'f' || peek() == 'F' {
        advance()
        addToken(TokenType.FloatLiteral, start, pos - start, start, valueEnd - start, false, tokenLine, tokenColumn)
      } else {
        addToken(TokenType.DoubleLiteral, start, pos - start, start, valueEnd - start, false, tokenLine, tokenColumn)
      }
      return
    }
    readNumericSuffix(start, pos, tokenLine, tokenColumn)
  }

  private function readNumericSuffix(valueStart: int, valueEnd: int, tokenLine: int, tokenColumn: int): void {
    if peek() == 'L' || peek() == 'l' {
      advance()
      addToken(TokenType.LongLiteral, valueStart, pos - valueStart, valueStart, valueEnd - valueStart, false, tokenLine, tokenColumn)
    } else if peek() == 'f' || peek() == 'F' {
      advance()
      addToken(TokenType.FloatLiteral, valueStart, pos - valueStart, valueStart, valueEnd - valueStart, false, tokenLine, tokenColumn)
    } else {
      addToken(TokenType.IntLiteral, valueStart, pos - valueStart, valueStart, valueEnd - valueStart, false, tokenLine, tokenColumn)
    }
  }

  private function readIdentifier(): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    while pos < source.length && isIdentPart(peek()) { advance() }

    let value = source.substring(start, pos)
    if value == "try" && (peek() == '!' || peek() == '?') {
      advance()
      addToken(TokenType.Identifier, start, pos - start, start, pos - start, false, tokenLine, tokenColumn)
      return
    }

    if value == "_" {
      addToken(TokenType.Underscore, start, pos - start, start, pos - start, false, tokenLine, tokenColumn)
    } else {
      addToken(keywordType(value), start, pos - start, start, pos - start, false, tokenLine, tokenColumn)
    }
  }

  private function readQuoted(delimiter: char): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    advance()
    contentStart := pos
    let needsDecode = false
    let closed = false

    while pos < source.length && peek() != delimiter {
      if peek() == '$' && peek(1) == '{' {
        addToken(TokenType.TemplateLiteralStart, start, pos - start, contentStart, pos - contentStart, needsDecode, tokenLine, tokenColumn)
        advance()
        advance()
        templateDelimiters.push(delimiter)
        braceDepth.push(0)
        return
      }
      if peek() == '\\' {
        needsDecode = true
        advance()
        advance()
      } else {
        advance()
      }
    }

    if pos < source.length {
      advance()
      closed = true
    }
    else { diagnostic("Unterminated string literal", tokenLine, tokenColumn) }
    let valueEnd = pos
    if closed { valueEnd = pos - 1 }
    addToken(TokenType.StringLiteral, start, pos - start, contentStart, valueEnd - contentStart, needsDecode, tokenLine, tokenColumn)
  }

  private function readTemplateContinuation(): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    delimiter := templateDelimiters[templateDelimiters.length - 1]
    contentStart := pos
    let needsDecode = false
    let closed = false

    while pos < source.length && peek() != delimiter {
      if peek() == '$' && peek(1) == '{' {
        addToken(TokenType.TemplateLiteralMiddle, start, pos - start, contentStart, pos - contentStart, needsDecode, tokenLine, tokenColumn)
        advance()
        advance()
        braceDepth.push(0)
        return
      }
      if peek() == '\\' {
        needsDecode = true
        advance()
        advance()
      } else {
        advance()
      }
    }

    if pos < source.length {
      advance()
      closed = true
    }
    else { diagnostic("Unterminated template literal", tokenLine, tokenColumn) }
    let valueEnd = pos
    if closed { valueEnd = pos - 1 }
    ignoredDelimiter := try! templateDelimiters.pop()
    addToken(TokenType.TemplateLiteralEnd, start, pos - start, contentStart, valueEnd - contentStart, needsDecode, tokenLine, tokenColumn)
  }

  private function readChar(): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    advance()
    valueStart := pos
    let needsDecode = false
    if peek() == '\\' {
      needsDecode = true
      advance()
      advance()
    } else if pos < source.length {
      advance()
    }
    valueEnd := pos
    if pos < source.length && peek() == '\'' { advance() }
    addToken(TokenType.CharLiteral, start, pos - start, valueStart, valueEnd - valueStart, needsDecode, tokenLine, tokenColumn)
  }

  private function emit(kind: TokenType, tokenLine: int, tokenColumn: int, start: int, count: int): void {
    // Operators are on the hot path. Unroll the tiny fixed-width consume so
    // no range/iterator object is created for each punctuation token.
    if count > 0 { advance() }
    if count > 1 { advance() }
    if count > 2 { advance() }
    if count > 3 { advance() }
    if count > 4 { advance() }
    if count > 5 { advance() }
    if count > 6 { advance() }
    addToken(kind, start, count, start, count, false, tokenLine, tokenColumn)
  }

  private function readOperatorOrPunctuation(): void {
    start := pos
    tokenLine := line
    tokenColumn := column
    ch := peek()

    if ch == '(' { emit(TokenType.LeftParen, tokenLine, tokenColumn, start, 1); return }
    if ch == ')' { emit(TokenType.RightParen, tokenLine, tokenColumn, start, 1); return }
    if ch == '{' {
      advance()
      if braceDepth.length > 0 { braceDepth[braceDepth.length - 1] = braceDepth[braceDepth.length - 1] + 1 }
      addToken(TokenType.LeftBrace, start, 1, start, 1, false, tokenLine, tokenColumn)
      return
    }
    if ch == '}' {
      advance()
      if braceDepth.length > 0 { braceDepth[braceDepth.length - 1] = braceDepth[braceDepth.length - 1] - 1 }
      addToken(TokenType.RightBrace, start, 1, start, 1, false, tokenLine, tokenColumn)
      return
    }
    if ch == '[' { emit(TokenType.LeftBracket, tokenLine, tokenColumn, start, 1); return }
    if ch == ']' { emit(TokenType.RightBracket, tokenLine, tokenColumn, start, 1); return }
    if ch == ',' { emit(TokenType.Comma, tokenLine, tokenColumn, start, 1); return }
    if ch == ';' { emit(TokenType.Semicolon, tokenLine, tokenColumn, start, 1); return }
    if ch == '~' { emit(TokenType.Tilde, tokenLine, tokenColumn, start, 1); return }

    if ch == '.' {
      if peek(1) == '.' && peek(2) == '.' { emit(TokenType.Ellipsis, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '.' && peek(2) == '<' { emit(TokenType.DotDotLess, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '.' { emit(TokenType.DotDot, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Dot, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == ':' {
      if peek(1) == ':' { emit(TokenType.DoubleColon, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.ColonEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Colon, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '=' {
      if peek(1) == '=' { emit(TokenType.EqualEqual, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '>' { emit(TokenType.Arrow, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Equal, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '+' {
      if peek(1) == '=' { emit(TokenType.PlusEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Plus, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '-' {
      if peek(1) == '>' { emit(TokenType.RightArrow, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.MinusEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Minus, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '*' {
      if peek(1) == '*' && peek(2) == '=' { emit(TokenType.StarStarEqual, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '*' { emit(TokenType.StarStar, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.StarEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Star, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '/' {
      if peek(1) == '=' { emit(TokenType.SlashEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Slash, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '%' {
      if peek(1) == '=' { emit(TokenType.PercentEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Percent, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '\\' {
      if peek(1) == '=' { emit(TokenType.BackslashEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Backslash, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '&' {
      if peek(1) == '&' { emit(TokenType.AmpersandAmpersand, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.AmpersandEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Ampersand, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '|' {
      if peek(1) == '|' { emit(TokenType.PipePipe, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.PipeEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Pipe, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '^' {
      if peek(1) == '=' { emit(TokenType.CaretEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Caret, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '<' {
      if peek(1) == '<' && peek(2) == '=' { emit(TokenType.LessLessEqual, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '<' { emit(TokenType.LessLess, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '-' { emit(TokenType.LeftArrow, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.LessEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Less, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '>' {
      if peek(1) == '>' && peek(2) == '>' && peek(3) == '=' { emit(TokenType.GreaterGreaterEqual, tokenLine, tokenColumn, start, 4) }
      else if peek(1) == '>' && peek(2) == '>' { emit(TokenType.GreaterGreaterGreater, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '>' && peek(2) == '=' { emit(TokenType.GreaterGreaterEqual, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '>' { emit(TokenType.GreaterGreater, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '=' { emit(TokenType.GreaterEqual, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Greater, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '!' {
      if peek(1) == '=' { emit(TokenType.BangEqual, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '.' { emit(TokenType.BangDot, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Bang, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '?' {
      if peek(1) == '?' && peek(2) == '=' { emit(TokenType.QuestionQuestionEqual, tokenLine, tokenColumn, start, 3) }
      else if peek(1) == '?' { emit(TokenType.QuestionQuestion, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '.' { emit(TokenType.QuestionDot, tokenLine, tokenColumn, start, 2) }
      else if peek(1) == '[' { emit(TokenType.QuestionBracket, tokenLine, tokenColumn, start, 2) }
      else { emit(TokenType.Identifier, tokenLine, tokenColumn, start, 1) }
      return
    }
    if ch == '@' && pos + 7 <= source.length && source.substring(pos, pos + 7) == "@caller" && !isIdentPart(peek(7)) {
      emit(TokenType.CallerIntrinsic, tokenLine, tokenColumn, start, 7)
      return
    }

    diagnostic("Unexpected character: '" + string(ch) + "'", line, column)
    advance()
  }
}
