export enum TokenType {
  // Literals
  IntLiteral = "IntLiteral",
  LongLiteral = "LongLiteral",
  FloatLiteral = "FloatLiteral",
  DoubleLiteral = "DoubleLiteral",
  StringLiteral = "StringLiteral",
  CharLiteral = "CharLiteral",
  TemplateLiteralStart = "TemplateLiteralStart",
  TemplateLiteralMiddle = "TemplateLiteralMiddle",
  TemplateLiteralEnd = "TemplateLiteralEnd",

  // Identifiers & Keywords
  Identifier = "Identifier",
  Const = "Const",
  Readonly = "Readonly",
  Let = "Let",
  Function = "Function",
  Return = "Return",
  Yield = "Yield",
  If = "If",
  Else = "Else",
  Then = "Then",
  While = "While",
  For = "For",
  Of = "Of",
  Break = "Break",
  Continue = "Continue",
  Case = "Case",
  Class = "Class",
  Interface = "Interface",
  Implements = "Implements",
  Enum = "Enum",
  Type = "Type",
  Import = "Import",
  Export = "Export",
  From = "From",
  As = "As",
  True = "True",
  False = "False",
  Null = "Null",
  Void = "Void",
  Try = "Try",
  Catch = "Catch",
  Static = "Static",
  This = "This",
  Weak = "Weak",
  Destructor = "Destructor",
  Async = "Async",
  Isolated = "Isolated",
  Private = "Private",
  With = "With",
  Mock = "Mock",

  // Operators
  Plus = "Plus",
  Minus = "Minus",
  Star = "Star",
  Slash = "Slash",
  Backslash = "Backslash",
  Percent = "Percent",
  StarStar = "StarStar",
  Ampersand = "Ampersand",
  Pipe = "Pipe",
  Caret = "Caret",
  Tilde = "Tilde",
  LessLess = "LessLess",
  GreaterGreater = "GreaterGreater",
  GreaterGreaterGreater = "GreaterGreaterGreater",
  AmpersandAmpersand = "AmpersandAmpersand",
  PipePipe = "PipePipe",
  Bang = "Bang",
  QuestionQuestion = "QuestionQuestion",

  // Comparison
  EqualEqual = "EqualEqual",
  BangEqual = "BangEqual",
  Less = "Less",
  LessEqual = "LessEqual",
  Greater = "Greater",
  GreaterEqual = "GreaterEqual",

  // Assignment
  Equal = "Equal",
  ColonEqual = "ColonEqual",
  PlusEqual = "PlusEqual",
  MinusEqual = "MinusEqual",
  StarEqual = "StarEqual",
  SlashEqual = "SlashEqual",
  BackslashEqual = "BackslashEqual",
  PercentEqual = "PercentEqual",
  StarStarEqual = "StarStarEqual",
  AmpersandEqual = "AmpersandEqual",
  PipeEqual = "PipeEqual",
  CaretEqual = "CaretEqual",
  LessLessEqual = "LessLessEqual",
  GreaterGreaterEqual = "GreaterGreaterEqual",
  QuestionQuestionEqual = "QuestionQuestionEqual",

  // Delimiters
  LeftParen = "LeftParen",
  RightParen = "RightParen",
  LeftBrace = "LeftBrace",
  RightBrace = "RightBrace",
  LeftBracket = "LeftBracket",
  RightBracket = "RightBracket",

  // Punctuation
  Dot = "Dot",
  DotDot = "DotDot",
  DotDotLess = "DotDotLess",
  Comma = "Comma",
  Colon = "Colon",
  DoubleColon = "DoubleColon",
  Semicolon = "Semicolon",
  Arrow = "Arrow",
  QuestionDot = "QuestionDot",
  BangDot = "BangDot",
  QuestionBracket = "QuestionBracket",
  Underscore = "Underscore",

  // Special
  DollarBrace = "DollarBrace",
  Ellipsis = "Ellipsis",

  // Meta
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
}

const KEYWORDS: Record<string, TokenType> = {
  const: TokenType.Const,
  readonly: TokenType.Readonly,
  let: TokenType.Let,
  function: TokenType.Function,
  return: TokenType.Return,
  yield: TokenType.Yield,
  if: TokenType.If,
  else: TokenType.Else,
  then: TokenType.Then,
  while: TokenType.While,
  for: TokenType.For,
  of: TokenType.Of,
  break: TokenType.Break,
  continue: TokenType.Continue,
  case: TokenType.Case,
  class: TokenType.Class,
  interface: TokenType.Interface,
  implements: TokenType.Implements,
  enum: TokenType.Enum,
  type: TokenType.Type,
  import: TokenType.Import,
  export: TokenType.Export,
  from: TokenType.From,
  as: TokenType.As,
  true: TokenType.True,
  false: TokenType.False,
  null: TokenType.Null,
  void: TokenType.Void,
  try: TokenType.Try,
  catch: TokenType.Catch,
  static: TokenType.Static,
  this: TokenType.This,
  weak: TokenType.Weak,
  destructor: TokenType.Destructor,
  async: TokenType.Async,
  isolated: TokenType.Isolated,
  private: TokenType.Private,
  with: TokenType.With,
  mock: TokenType.Mock,
};

export interface LexerDiagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];
  public diagnostics: LexerDiagnostic[] = [];

  /** Track template literal nesting for ${} interpolation */
  private templateDepth: number = 0;
  private braceDepth: number[] = [];
  private templateDelimiters: string[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      // Check for template literal continuation when closing a ${}
      if (
        this.templateDepth > 0 &&
        this.peek() === "}" &&
        this.braceDepth.length > 0 &&
        this.braceDepth[this.braceDepth.length - 1] === 0
      ) {
        this.braceDepth.pop();
        this.pos++; // consume }
        this.column++;
        this.readTemplateContinuation();
        continue;
      }

      const ch = this.peek();

      if (ch === '"') {
        this.readStringOrInterpolatedString();
      } else if (ch === '`') {
        this.readTemplateLiteral();
      } else if (ch === "'") {
        this.readChar();
      } else if (this.isDigit(ch)) {
        this.readNumber();
      } else if (this.isIdentStart(ch)) {
        this.readIdentifier();
      } else {
        this.readOperatorOrPunctuation();
      }
    }

    this.addToken(TokenType.EOF, "", this.line, this.column);
    return this.tokens;
  }

  private peek(offset: number = 0): string {
    return this.source[this.pos + offset] ?? "\0";
  }

  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private addToken(type: TokenType, value: string, line: number, column: number): void {
    this.tokens.push({
      type,
      value,
      line,
      column,
      offset: this.pos - value.length,
    });
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else if (ch === "/" && this.peek(1) === "/") {
        // Line comment
        while (this.pos < this.source.length && this.peek() !== "\n") {
          this.advance();
        }
      } else if (ch === "/" && this.peek(1) === "*") {
        // Block comment
        const commentLine = this.line;
        const commentCol = this.column;
        this.advance(); // /
        this.advance(); // *
        let terminated = false;
        while (this.pos < this.source.length) {
          if (this.peek() === "*" && this.peek(1) === "/") {
            this.advance(); // *
            this.advance(); // /
            terminated = true;
            break;
          }
          this.advance();
        }
        if (!terminated) {
          this.diagnostics.push({
            severity: "error",
            message: "Unterminated block comment",
            line: commentLine,
            column: commentCol,
          });
        }
      } else {
        break;
      }
    }
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private readStringOrInterpolatedString(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // opening "
    let value = "";

    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === "$" && this.peek(1) === "{") {
        this.addToken(TokenType.TemplateLiteralStart, value, startLine, startCol);
        this.advance(); // $
        this.advance(); // {
        this.templateDepth++;
        this.braceDepth.push(0);
        this.templateDelimiters.push('"');
        return;
      }

      if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          case "$": value += "$"; break;
          case "0": value += "\0"; break;
          default: value += esc;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.pos < this.source.length) {
      this.advance(); // closing "
    } else {
      this.diagnostics.push({
        severity: "error",
        message: "Unterminated string literal",
        line: startLine,
        column: startCol,
      });
    }

    this.addToken(TokenType.StringLiteral, value, startLine, startCol);
  }

  private readTemplateLiteral(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // opening `
    let value = "";

    while (this.pos < this.source.length && this.peek() !== '`') {
      if (this.peek() === "$" && this.peek(1) === "{") {
        // Template interpolation start
        this.addToken(TokenType.TemplateLiteralStart, value, startLine, startCol);
        this.advance(); // $
        this.advance(); // {
        this.templateDepth++;
        this.braceDepth.push(0);
        this.templateDelimiters.push("`");
        return;
      } else if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case "`": value += "`"; break;
          case "$": value += "$"; break;
          default: value += esc;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.pos < this.source.length) {
      this.advance(); // closing `
    } else {
      this.diagnostics.push({
        severity: "error",
        message: "Unterminated template literal",
        line: startLine,
        column: startCol,
      });
    }

    // Simple template with no interpolations: emit as regular string
    this.addToken(TokenType.StringLiteral, value, startLine, startCol);
  }

  private readTemplateContinuation(): void {
    const startLine = this.line;
    const startCol = this.column;
    const delimiter = this.templateDelimiters[this.templateDelimiters.length - 1] ?? "`";
    let value = "";

    while (this.pos < this.source.length && this.peek() !== delimiter) {
      if (this.peek() === "$" && this.peek(1) === "{") {
        this.addToken(TokenType.TemplateLiteralMiddle, value, startLine, startCol);
        this.advance(); // $
        this.advance(); // {
        this.braceDepth.push(0);
        return;
      } else if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          case "\\": value += "\\"; break;
          case '"':
            if (delimiter === '"') value += '"';
            else value += esc;
            break;
          case "`":
            if (delimiter === "`") value += "`";
            else value += esc;
            break;
          case "$": value += "$"; break;
          default: value += esc;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.pos < this.source.length) {
      this.advance(); // closing `
    } else {
      this.diagnostics.push({
        severity: "error",
        message: "Unterminated template literal",
        line: startLine,
        column: startCol,
      });
    }

    this.templateDepth--;
    this.templateDelimiters.pop();
    this.addToken(TokenType.TemplateLiteralEnd, value, startLine, startCol);
  }

  private readChar(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // opening '
    let value: string;

    if (this.peek() === "\\") {
      this.advance();
      const esc = this.advance();
      switch (esc) {
        case "n": value = "\n"; break;
        case "t": value = "\t"; break;
        case "r": value = "\r"; break;
        case "\\": value = "\\"; break;
        case "'": value = "'"; break;
        case "0": value = "\0"; break;
        default: value = esc;
      }
    } else {
      value = this.advance();
    }

    if (this.pos < this.source.length && this.peek() === "'") {
      this.advance(); // closing '
    }

    this.addToken(TokenType.CharLiteral, value, startLine, startCol);
  }

  private readNumber(): void {
    const startLine = this.line;
    const startCol = this.column;
    let num = "";

    // Check for hex/binary/octal prefixes
    if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      num += this.advance(); // 0
      num += this.advance(); // x
      num += this.readDigitsWithSeparators(ch => this.isHexDigit(ch));
      this.checkNumericSuffix(num, startLine, startCol);
      return;
    }

    if (this.peek() === "0" && (this.peek(1) === "b" || this.peek(1) === "B")) {
      num += this.advance(); // 0
      num += this.advance(); // b
      num += this.readDigitsWithSeparators(ch => ch === "0" || ch === "1");
      this.checkNumericSuffix(num, startLine, startCol);
      return;
    }

    // Integer or float
    num += this.readDigitsWithSeparators(ch => this.isDigit(ch));

    if (this.peek() === "." && this.peek(1) !== "." && this.peek(1) !== "<") {
      // Float
      num += this.advance(); // .
      num += this.readDigitsWithSeparators(ch => this.isDigit(ch));
      // Check for float suffix
      if (this.peek() === "f" || this.peek() === "F") {
        this.advance();
        this.addToken(TokenType.FloatLiteral, num, startLine, startCol);
      } else {
        this.addToken(TokenType.DoubleLiteral, num, startLine, startCol);
      }
    } else {
      this.checkNumericSuffix(num, startLine, startCol);
    }
  }

  private readDigitsWithSeparators(isDigit: (ch: string) => boolean): string {
    let digits = "";
    let sawDigit = false;

    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (isDigit(ch)) {
        digits += this.advance();
        sawDigit = true;
        continue;
      }

      if (ch !== "_") {
        break;
      }

      if (sawDigit && isDigit(this.peek(1))) {
        this.advance();
        continue;
      }

      const separatorLine = this.line;
      const separatorColumn = this.column;
      while (this.peek() === "_") {
        this.advance();
      }
      this.diagnostics.push({
        severity: "error",
        message: "Numeric separators must appear between digits",
        line: separatorLine,
        column: separatorColumn,
      });
    }

    return digits;
  }

  private checkNumericSuffix(num: string, startLine: number, startCol: number): void {
    if (this.peek() === "L" || this.peek() === "l") {
      this.advance();
      this.addToken(TokenType.LongLiteral, num, startLine, startCol);
    } else if (this.peek() === "f" || this.peek() === "F") {
      this.advance();
      this.addToken(TokenType.FloatLiteral, num, startLine, startCol);
    } else {
      this.addToken(TokenType.IntLiteral, num, startLine, startCol);
    }
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
  }

  private readIdentifier(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (this.pos < this.source.length && this.isIdentPart(this.peek())) {
      value += this.advance();
    }

    // Check for `try!` and `try?` keywords
    if (value === "try" && (this.peek() === "!" || this.peek() === "?")) {
      value += this.advance();
      if (value === "try!") {
        this.addToken(TokenType.Identifier, value, startLine, startCol);
        return;
      }
      if (value === "try?") {
        this.addToken(TokenType.Identifier, value, startLine, startCol);
        return;
      }
    }

    const kwType = Object.hasOwn(KEYWORDS, value) ? KEYWORDS[value] : undefined;
    if (value === "_") {
      this.addToken(TokenType.Underscore, value, startLine, startCol);
    } else if (kwType !== undefined) {
      this.addToken(kwType, value, startLine, startCol);
    } else {
      this.addToken(TokenType.Identifier, value, startLine, startCol);
    }
  }

  private readOperatorOrPunctuation(): void {
    const startLine = this.line;
    const startCol = this.column;
    const ch = this.peek();

    switch (ch) {
      case "(": this.advance(); this.addToken(TokenType.LeftParen, "(", startLine, startCol); break;
      case ")": this.advance(); this.addToken(TokenType.RightParen, ")", startLine, startCol); break;
      case "{":
        this.advance();
        // Track brace depth for template literals
        if (this.braceDepth.length > 0) {
          this.braceDepth[this.braceDepth.length - 1]++;
        }
        this.addToken(TokenType.LeftBrace, "{", startLine, startCol);
        break;
      case "}":
        this.advance();
        if (this.braceDepth.length > 0) {
          this.braceDepth[this.braceDepth.length - 1]--;
        }
        this.addToken(TokenType.RightBrace, "}", startLine, startCol);
        break;
      case "[": this.advance(); this.addToken(TokenType.LeftBracket, "[", startLine, startCol); break;
      case "]": this.advance(); this.addToken(TokenType.RightBracket, "]", startLine, startCol); break;
      case ",": this.advance(); this.addToken(TokenType.Comma, ",", startLine, startCol); break;
      case ";": this.advance(); this.addToken(TokenType.Semicolon, ";", startLine, startCol); break;
      case "~": this.advance(); this.addToken(TokenType.Tilde, "~", startLine, startCol); break;

      case ".":
        if (this.peek(1) === "." && this.peek(2) === ".") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.Ellipsis, "...", startLine, startCol);
        } else if (this.peek(1) === "." && this.peek(2) === "<") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.DotDotLess, "..<", startLine, startCol);
        } else if (this.peek(1) === ".") {
          this.advance(); this.advance();
          this.addToken(TokenType.DotDot, "..", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Dot, ".", startLine, startCol);
        }
        break;

      case ":":
        if (this.peek(1) === ":") {
          this.advance(); this.advance();
          this.addToken(TokenType.DoubleColon, "::", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.ColonEqual, ":=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Colon, ":", startLine, startCol);
        }
        break;

      case "=":
        if (this.peek(1) === "=" ) {
          this.advance(); this.advance();
          this.addToken(TokenType.EqualEqual, "==", startLine, startCol);
        } else if (this.peek(1) === ">") {
          this.advance(); this.advance();
          this.addToken(TokenType.Arrow, "=>", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Equal, "=", startLine, startCol);
        }
        break;

      case "+":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.PlusEqual, "+=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Plus, "+", startLine, startCol);
        }
        break;

      case "-":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.MinusEqual, "-=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Minus, "-", startLine, startCol);
        }
        break;

      case "*":
        if (this.peek(1) === "*" && this.peek(2) === "=") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.StarStarEqual, "**=", startLine, startCol);
        } else if (this.peek(1) === "*") {
          this.advance(); this.advance();
          this.addToken(TokenType.StarStar, "**", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.StarEqual, "*=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Star, "*", startLine, startCol);
        }
        break;

      case "/":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.SlashEqual, "/=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Slash, "/", startLine, startCol);
        }
        break;

      case "%":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.PercentEqual, "%=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Percent, "%", startLine, startCol);
        }
        break;

      case "\\":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.BackslashEqual, "\\=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Backslash, "\\", startLine, startCol);
        }
        break;

      case "&":
        if (this.peek(1) === "&") {
          this.advance(); this.advance();
          this.addToken(TokenType.AmpersandAmpersand, "&&", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.AmpersandEqual, "&=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Ampersand, "&", startLine, startCol);
        }
        break;

      case "|":
        if (this.peek(1) === "|") {
          this.advance(); this.advance();
          this.addToken(TokenType.PipePipe, "||", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.PipeEqual, "|=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Pipe, "|", startLine, startCol);
        }
        break;

      case "^":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.CaretEqual, "^=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Caret, "^", startLine, startCol);
        }
        break;

      case "<":
        if (this.peek(1) === "<" && this.peek(2) === "=") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.LessLessEqual, "<<=", startLine, startCol);
        } else if (this.peek(1) === "<") {
          this.advance(); this.advance();
          this.addToken(TokenType.LessLess, "<<", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.LessEqual, "<=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Less, "<", startLine, startCol);
        }
        break;

      case ">":
        if (this.peek(1) === ">" && this.peek(2) === ">" && this.peek(3) === "=") {
          // >>>= not in spec, but handle >>>=
          this.advance(); this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.GreaterGreaterEqual, ">>>=", startLine, startCol);
        } else if (this.peek(1) === ">" && this.peek(2) === ">") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.GreaterGreaterGreater, ">>>", startLine, startCol);
        } else if (this.peek(1) === ">" && this.peek(2) === "=") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.GreaterGreaterEqual, ">>=", startLine, startCol);
        } else if (this.peek(1) === ">") {
          this.advance(); this.advance();
          this.addToken(TokenType.GreaterGreater, ">>", startLine, startCol);
        } else if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.GreaterEqual, ">=", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Greater, ">", startLine, startCol);
        }
        break;

      case "!":
        if (this.peek(1) === "=") {
          this.advance(); this.advance();
          this.addToken(TokenType.BangEqual, "!=", startLine, startCol);
        } else if (this.peek(1) === ".") {
          this.advance(); this.advance();
          this.addToken(TokenType.BangDot, "!.", startLine, startCol);
        } else {
          this.advance();
          this.addToken(TokenType.Bang, "!", startLine, startCol);
        }
        break;

      case "?":
        if (this.peek(1) === "?" && this.peek(2) === "=") {
          this.advance(); this.advance(); this.advance();
          this.addToken(TokenType.QuestionQuestionEqual, "??=", startLine, startCol);
        } else if (this.peek(1) === "?") {
          this.advance(); this.advance();
          this.addToken(TokenType.QuestionQuestion, "??", startLine, startCol);
        } else if (this.peek(1) === ".") {
          this.advance(); this.advance();
          this.addToken(TokenType.QuestionDot, "?.", startLine, startCol);
        } else if (this.peek(1) === "[") {
          this.advance(); this.advance();
          this.addToken(TokenType.QuestionBracket, "?[", startLine, startCol);
        } else {
          this.advance();
          // ? alone is not used in Doof, emit as identifier for error reporting
          this.addToken(TokenType.Identifier, "?", startLine, startCol);
        }
        break;

      default:
        // Unknown character — report error and skip
        this.diagnostics.push({
          severity: "error",
          message: `Unexpected character: '${this.peek()}'`,
          line: this.line,
          column: this.column,
        });
        this.advance();
        break;
    }
  }
}
