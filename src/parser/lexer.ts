// Lexer for doof language

import { Position, SourceLocation } from '../types';

export enum TokenType {
  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  CHAR_LITERAL = 'CHAR_LITERAL',
  TEMPLATE_STRING = 'TEMPLATE_STRING',
  INTERPOLATION_START = 'INTERPOLATION_START', // ${
  INTERPOLATION_END = 'INTERPOLATION_END', // }
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',

  // Identifiers and keywords
  IDENTIFIER = 'IDENTIFIER',

  // Keywords
  LET = 'let',
  CONST = 'const',
  READONLY = 'readonly',
  FUNCTION = 'function',
  CLASS = 'class',
  EXTERN = 'extern',
  ENUM = 'enum',
  INTERFACE = 'interface',
  EXTENDS = 'extends',
  PRIVATE = 'private',
  STATIC = 'static',
  WEAK = 'weak',
  EXPORT = 'export',
  IMPORT = 'import',
  FROM = 'from',
  THIS = 'this',
  IF = 'if',
  ELSE = 'else',
  WHILE = 'while',
  DO = 'do',
  FOR = 'for',
  OF = 'of',
  IN = 'in',
  SWITCH = 'switch',
  CASE = 'case',
  DEFAULT = 'default',
  BREAK = 'break',
  CONTINUE = 'continue',
  RETURN = 'return',
  IS = 'is',
  TYPE = 'type',

  // Types
  INT = 'int',
  FLOAT = 'float',
  DOUBLE = 'double',
  BOOL = 'bool',
  CHAR = 'char',
  STRING_TYPE = 'string',
  VOID = 'void',
  MAP = 'Map',
  SET = 'Set',

  // Operators
  PLUS = '+',
  MINUS = '-',
  MULTIPLY = '*',
  DIVIDE = '/',
  MODULO = '%',
  ASSIGN = '=',
  PLUS_ASSIGN = '+=',
  MINUS_ASSIGN = '-=',
  MULTIPLY_ASSIGN = '*=',
  DIVIDE_ASSIGN = '/=',
  MODULO_ASSIGN = '%=',
  INCREMENT = '++',
  DECREMENT = '--',

  // Comparison
  EQUAL = '==',
  NOT_EQUAL = '!=',
  LESS_THAN = '<',
  LESS_EQUAL = '<=',
  GREATER_THAN = '>',
  GREATER_EQUAL = '>=',
  SELF_CLOSE = 'SELF_CLOSE', // '/>' for XML self-closing tags

  // Logical
  AND = '&&',
  OR = '||',
  NOT = '!',

  // Null safety operators
  NULL_COALESCE = '??',
  OPTIONAL_CHAIN = '?.',

  // Bitwise
  BITWISE_AND = '&',
  BITWISE_OR = '|',
  BITWISE_XOR = '^',
  BITWISE_NOT = '~',
  LEFT_SHIFT = '<<',
  RIGHT_SHIFT = '>>',

    NEW = 'new',

  // Doof extension: allow 'new' as optional operator
  // ...existing code...

  // Punctuation
  SEMICOLON = ';',
  COMMA = ',',
  DOT = '.',
  COLON = ':',
  QUESTION = '?',
  ARROW = '=>',
  RANGE_INCLUSIVE = '..',
  RANGE_EXCLUSIVE = '..<',

  // Brackets
  LEFT_PAREN = '(',
  RIGHT_PAREN = ')',
  LEFT_BRACE = '{',
  RIGHT_BRACE = '}',
  LEFT_BRACKET = '[',
  RIGHT_BRACKET = ']',

  // Special
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  WHITESPACE = 'WHITESPACE',
  LINE_COMMENT = 'LINE_COMMENT',
  BLANK_LINE = 'BLANK_LINE',

  // Markdown
  MD_HEADER = 'MD_HEADER',
  MD_TABLE_ROW = 'MD_TABLE_ROW'
}

export interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}

// Use a Map for keywords to avoid prototype collisions (e.g. toString)
const KEYWORDS: Map<string, TokenType> = new Map([
  ['let', TokenType.LET],
  ['const', TokenType.CONST],
  ['readonly', TokenType.READONLY],
  ['function', TokenType.FUNCTION],
  ['class', TokenType.CLASS],
  ['extern', TokenType.EXTERN],
  ['enum', TokenType.ENUM],
  ['interface', TokenType.INTERFACE],
  ['extends', TokenType.EXTENDS],
  ['private', TokenType.PRIVATE],
  ['static', TokenType.STATIC],
  ['weak', TokenType.WEAK],
  ['export', TokenType.EXPORT],
  ['import', TokenType.IMPORT],
  ['from', TokenType.FROM],
  ['this', TokenType.THIS],
  ['if', TokenType.IF],
  ['else', TokenType.ELSE],
  ['while', TokenType.WHILE],
  ['do', TokenType.DO],
  ['for', TokenType.FOR],
  ['of', TokenType.OF],
  ['in', TokenType.IN],
  ['switch', TokenType.SWITCH],
  ['case', TokenType.CASE],
  ['default', TokenType.DEFAULT],
  ['break', TokenType.BREAK],
  ['continue', TokenType.CONTINUE],
  ['return', TokenType.RETURN],
  ['is', TokenType.IS],
  ['type', TokenType.TYPE],
  ['true', TokenType.BOOLEAN],
  ['false', TokenType.BOOLEAN],
  ['null', TokenType.NULL],
  ['int', TokenType.INT],
  ['float', TokenType.FLOAT],
  ['double', TokenType.DOUBLE],
  ['bool', TokenType.BOOL],
  ['char', TokenType.CHAR],
  ['string', TokenType.STRING_TYPE],
  ['void', TokenType.VOID],
  ['Map', TokenType.MAP],
  ['Set', TokenType.SET],
  ['new', TokenType.NEW]
]);

export class Lexer {
  private input: string;
  private position: number = 0;
  private line: number = 1;
  private column: number = 1;
  private filename?: string;

  constructor(input: string, filename?: string) {
    this.input = input;
    this.filename = filename;
  }

  private current(): string {
    return this.input[this.position] || '';
  }

  private peek(offset: number = 1): string {
    return this.input[this.position + offset] || '';
  }

  private advance(): string {
    const char = this.current();
    this.position++;
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private createPosition(): Position {
    return { line: this.line, column: this.column };
  }

  private createLocation(start: Position): SourceLocation {
    return {
      start,
      end: this.createPosition(),
      filename: this.filename
    };
  }

  private isAtLineStart(): boolean {
    if (this.position === 0) {
      return true;
    }

    let index = this.position - 1;
    while (index >= 0) {
      const ch = this.input[index];
      if (ch === '\n') {
        return true;
      }
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
        return false;
      }
      index--;
    }
    return true;
  }

  private readMarkdownLine(): string {
    let value = '';
    while (this.current() !== '\n' && this.current() !== '') {
      value += this.current();
      this.advance();
    }
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.current()) && this.current() !== '\n') {
      this.advance();
    }
  }

  private readLineComment(): string {
    let value = '';
    // Skip //
    this.advance();
    this.advance();

    while (this.current() !== '\n' && this.current() !== '') {
      value += this.advance();
    }

    return value;
  }

  private skipBlockComment(): void {
    // Skip /*
    this.advance();
    this.advance();

    while (this.current() !== '' && !(this.current() === '*' && this.peek() === '/')) {
      this.advance();
    }

    if (this.current() === '*') {
      this.advance(); // *
      this.advance(); // /
    }
  }

  private readString(quote: string): string {
    let value = '';
    this.advance(); // Skip opening quote

    while (this.current() !== quote && this.current() !== '') {
      if (this.current() === '\\') {
        this.advance();
        const escaped = this.current();
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          case '0': value += '\0'; break;
          default: value += escaped; break;
        }
      } else {
        value += this.current();
      }
      this.advance();
    }

    if (this.current() === quote) {
      this.advance(); // Skip closing quote
    }

    return value;
  }

  private readInterpolatedString(quote: string): Token[] {
    const tokens: Token[] = [];
    let currentString = '';
    let startPos = this.createPosition();

    this.advance(); // Skip opening quote

    while (this.current() !== quote && this.current() !== '') {
      if (this.current() === '\\') {
        this.advance();
        const escaped = this.current();
        switch (escaped) {
          case 'n': currentString += '\n'; break;
          case 't': currentString += '\t'; break;
          case 'r': currentString += '\r'; break;
          case '\\': currentString += '\\'; break;
          case '"': currentString += '"'; break;
          case "'": currentString += "'"; break;
          case '`': currentString += '`'; break;
          default: currentString += escaped; break;
        }
        this.advance();
      } else if (this.current() === '$' && this.peek() === '{') {
        // Found interpolation start
        if (currentString.length > 0) {
          tokens.push({
            type: quote === '`' ? TokenType.TEMPLATE_STRING : TokenType.STRING,
            value: currentString,
            location: this.createLocation(startPos)
          });
          currentString = '';
          startPos = this.createPosition();
        }

        this.advance(); // Skip $
        this.advance(); // Skip {

        tokens.push({
          type: TokenType.INTERPOLATION_START,
          value: '${',
          location: this.createLocation(this.createPosition())
        });

        startPos = this.createPosition();

        // Tokenize the expression inside interpolation
        let braceCount = 1;
        const exprStart = this.position;

        while (braceCount > 0 && this.current() !== '') {
          if (this.current() === '{') {
            braceCount++;
          } else if (this.current() === '}') {
            braceCount--;
          }

          if (braceCount > 0) {
            this.advance();
          }
        }

        if (braceCount === 0) {
          const expr = this.input.slice(exprStart, this.position);
          const exprLexer = new Lexer(expr, this.filename);
          const exprTokens = exprLexer.tokenize();
          exprTokens.forEach(t => {
            t.location.start.line += startPos.line - 1;
            t.location.start.column += startPos.column - 1;
            t.location.end.line += startPos.line - 1;
            t.location.end.column += startPos.column - 1;
          })
          tokens.push(...exprTokens.filter(t => t.type !== TokenType.EOF));

          tokens.push({
            type: TokenType.INTERPOLATION_END,
            value: '}',
            location: this.createLocation(this.createPosition())
          });

          this.advance(); // Skip closing }
          startPos = this.createPosition();
        }
      } else {
        currentString += this.current();
        this.advance();
      }
    }

    // Add final string part if any
    if (currentString.length > 0) {
      tokens.push({
        type: quote === '`' ? TokenType.TEMPLATE_STRING : TokenType.STRING,
        value: currentString,
        location: this.createLocation(startPos)
      });
    } else if (tokens.length === 0) {
      // If no interpolations were found, create a simple literal
      tokens.push({
        type: quote === '`' ? TokenType.TEMPLATE_STRING : TokenType.STRING,
        value: currentString,
        location: this.createLocation(startPos)
      });
    }

    if (this.current() === quote) {
      this.advance(); // Skip closing quote
    }

    return tokens;
  }

  private readNumber(): string {
    let value = '';
    let hasDecimal = false;

    while (/[\d.]/.test(this.current())) {
      if (this.current() === '.') {
        if (hasDecimal || this.peek() === '.') { // Don't consume .. or ..<
          break;
        }
        hasDecimal = true;
      }
      value += this.advance();
    }

    // Check for float suffix 'f' or 'F'
    if (this.current() === 'f' || this.current() === 'F') {
      value += this.advance();
    }

    return value;
  }

  private readIdentifier(): string {
    let value = '';
    while (/[a-zA-Z0-9_]/.test(this.current())) {
      value += this.advance();
    }
    return value;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.position < this.input.length) {
      const start = this.createPosition();

      // Skip whitespace (except newlines)
      if (/[ \t\r]/.test(this.current())) {
        this.skipWhitespace();
        continue;
      }

      // Newlines
      if (this.current() === '\n') {
        tokens.push({
          type: TokenType.NEWLINE,
          value: this.advance(),
          location: this.createLocation(start)
        });
        continue;
      }

      if (this.isAtLineStart()) {
        if (this.current() === '#') {
          const value = this.readMarkdownLine();
          tokens.push({
            type: TokenType.MD_HEADER,
            value,
            location: this.createLocation(start)
          });
          continue;
        }

        if (this.current() === '|') {
          const value = this.readMarkdownLine();
          tokens.push({
            type: TokenType.MD_TABLE_ROW,
            value,
            location: this.createLocation(start)
          });
          continue;
        }
      }

      // Comments
      if (this.current() === '/' && this.peek() === '/') {
        const commentValue = this.readLineComment();
        tokens.push({
          type: TokenType.LINE_COMMENT,
          value: commentValue,
          location: this.createLocation(start)
        });
        continue;
      }

      if (this.current() === '/' && this.peek() === '*') {
        this.skipBlockComment();
        continue;
      }

      // Strings and chars
      if (this.current() === '"' || this.current() === '\'' || this.current() === '`') {
        const quote = this.current();
        // Special handling for single-quoted literals
        if (quote === "'") {
          // Look ahead to find the matching closing quote
          let tempPos = this.position + 1;
          let value = '';
          let isEscaped = false;
          while (tempPos < this.input.length) {
            const ch = this.input[tempPos];
            if (!isEscaped && ch === "'") break;
            if (!isEscaped && ch === '\\') {
              isEscaped = true;
            } else {
              isEscaped = false;
            }
            value += ch;
            tempPos++;
          }
          // Use readString to process escapes and advance position
          const processed = this.readString("'");
          if (processed.length === 1) {
            tokens.push({
              type: TokenType.CHAR_LITERAL,
              value: processed,
              location: this.createLocation(start)
            });
          } else {
            tokens.push({
              type: TokenType.STRING,
              value: processed,
              location: this.createLocation(start)
            });
          }
          continue;
        }
        // Handle string literals (double quotes or backticks)
        // Check if string contains interpolation
        let hasInterpolation = false;
        if (quote === '"' || quote === '`') {
          let tempPos = this.position + 1;
          while (tempPos < this.input.length && this.input[tempPos] !== quote) {
            if (this.input[tempPos] === '$' && this.input[tempPos + 1] === '{') {
              hasInterpolation = true;
              break;
            }
            if (this.input[tempPos] === '\\') {
              tempPos++; // Skip escaped character
            }
            tempPos++;
          }
        }
        if (hasInterpolation) {
          const interpolatedTokens = this.readInterpolatedString(quote);
          tokens.push(...interpolatedTokens);
        } else {
          const value = this.readString(quote);
          tokens.push({
            type: quote === '`' ? TokenType.TEMPLATE_STRING : TokenType.STRING,
            value,
            location: this.createLocation(start)
          });
        }
        continue;
      }

      // Numbers
      if (/\d/.test(this.current())) {
        const value = this.readNumber();
        tokens.push({
          type: TokenType.NUMBER,
          value,
          location: this.createLocation(start)
        });
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(this.current())) {
        const value = this.readIdentifier();
        const tokenType = KEYWORDS.get(value) ?? TokenType.IDENTIFIER;
        tokens.push({
          type: tokenType,
          value,
          location: this.createLocation(start)
        });
        continue;
      }

      // Two-character operators
      const twoChar = this.current() + this.peek();
      // Special XML self-closing token recognition BEFORE generic two-char switch
      if (this.current() === '/' && this.peek() === '>') {
        const startPos = start;
        this.advance(); // '/'
        this.advance(); // '>'
        tokens.push({ type: TokenType.SELF_CLOSE, value: '/>', location: this.createLocation(startPos) });
        continue;
      }
      switch (twoChar) {
        case '++':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.INCREMENT, value: '++', location: this.createLocation(start) });
          continue;
        case '--':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.DECREMENT, value: '--', location: this.createLocation(start) });
          continue;
        case '+=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.PLUS_ASSIGN, value: '+=', location: this.createLocation(start) });
          continue;
        case '-=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.MINUS_ASSIGN, value: '-=', location: this.createLocation(start) });
          continue;
        case '*=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.MULTIPLY_ASSIGN, value: '*=', location: this.createLocation(start) });
          continue;
        case '/=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.DIVIDE_ASSIGN, value: '/=', location: this.createLocation(start) });
          continue;
        case '%=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.MODULO_ASSIGN, value: '%=', location: this.createLocation(start) });
          continue;
        case '==':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.EQUAL, value: '==', location: this.createLocation(start) });
          continue;
        case '!=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.NOT_EQUAL, value: '!=', location: this.createLocation(start) });
          continue;
        case '<=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.LESS_EQUAL, value: '<=', location: this.createLocation(start) });
          continue;
        case '>=':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.GREATER_EQUAL, value: '>=', location: this.createLocation(start) });
          continue;
        case '&&':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.AND, value: '&&', location: this.createLocation(start) });
          continue;
        case '||':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.OR, value: '||', location: this.createLocation(start) });
          continue;
        case '??':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.NULL_COALESCE, value: '??', location: this.createLocation(start) });
          continue;
        case '?.':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.OPTIONAL_CHAIN, value: '?.', location: this.createLocation(start) });
          continue;
        case '<<':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.LEFT_SHIFT, value: '<<', location: this.createLocation(start) });
          continue;
        case '>>':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.RIGHT_SHIFT, value: '>>', location: this.createLocation(start) });
          continue;
        case '=>':
          this.advance();
          this.advance();
          tokens.push({ type: TokenType.ARROW, value: '=>', location: this.createLocation(start) });
          continue;
          tokens.push({ type: TokenType.OPTIONAL_CHAIN, value: '?.', location: this.createLocation(start) });
          continue;
        case '..':
          if (this.peek(2) === '<') {
            // ..<
            this.advance();
            this.advance();
            this.advance();
            tokens.push({ type: TokenType.RANGE_EXCLUSIVE, value: '..<', location: this.createLocation(start) });
          } else {
            // ..
            this.advance();
            this.advance();
            tokens.push({ type: TokenType.RANGE_INCLUSIVE, value: '..', location: this.createLocation(start) });
          }
          continue;
      }

      // Single-character operators and punctuation
      const char = this.advance();
      let tokenType: TokenType;

      switch (char) {
        case '+': tokenType = TokenType.PLUS; break;
        case '-': tokenType = TokenType.MINUS; break;
        case '*': tokenType = TokenType.MULTIPLY; break;
        case '/': tokenType = TokenType.DIVIDE; break;
        case '%': tokenType = TokenType.MODULO; break;
        case '=': tokenType = TokenType.ASSIGN; break;
        case '<': tokenType = TokenType.LESS_THAN; break;
        case '>': tokenType = TokenType.GREATER_THAN; break;
        case '!': tokenType = TokenType.NOT; break;
        case '&': tokenType = TokenType.BITWISE_AND; break;
        case '|': tokenType = TokenType.BITWISE_OR; break;
        case '^': tokenType = TokenType.BITWISE_XOR; break;
        case '~': tokenType = TokenType.BITWISE_NOT; break;
        case ';': tokenType = TokenType.SEMICOLON; break;
        case ',': tokenType = TokenType.COMMA; break;
        case '.': tokenType = TokenType.DOT; break;
        case ':': tokenType = TokenType.COLON; break;
        case '?': tokenType = TokenType.QUESTION; break;
        case '(': tokenType = TokenType.LEFT_PAREN; break;
        case ')': tokenType = TokenType.RIGHT_PAREN; break;
        case '{': tokenType = TokenType.LEFT_BRACE; break;
        case '}': tokenType = TokenType.RIGHT_BRACE; break;
        case '[': tokenType = TokenType.LEFT_BRACKET; break;
        case ']': tokenType = TokenType.RIGHT_BRACKET; break;
        default:
          throw new Error(`Unexpected character '${char}' at ${this.line}:${this.column}`);
      }

      tokens.push({
        type: tokenType,
        value: char,
        location: this.createLocation(start)
      });
    }

    tokens.push({
      type: TokenType.EOF,
      value: '',
      location: this.createLocation(this.createPosition())
    });

    return tokens;
  }
}
