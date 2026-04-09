/**
 * Lightweight lexer for Doof semantic token highlighting.
 * Produces positioned tokens suitable for mapping to VS Code SemanticTokenTypes.
 */

export const enum DoofTokenKind {
  // Literals
  IntLiteral,
  LongLiteral,
  FloatLiteral,
  DoubleLiteral,
  StringLiteral,
  CharLiteral,
  TemplateHead,
  TemplateTail,

  // Identifiers & keywords
  Identifier,
  Keyword,
  StorageKeyword,
  StorageModifier,
  TypeKeyword,
  BuiltinType,
  BooleanLiteral,
  NullLiteral,
  ThisKeyword,

  // Comments
  LineComment,
  BlockComment,

  // Operators & punctuation
  Operator,
  Punctuation,

  // Definitions (contextual — emitted when we see `function name`, `class Name`, etc.)
  FunctionDef,
  ClassDef,
  InterfaceDef,
  EnumDef,
  TypeAliasDef,

  // Function call (identifier immediately before `(`)
  FunctionCall,

  // Type annotation context (PascalCase identifier after `:` or in generic args)
  TypeReference,

  // Parameter name (identifier in function parameter list)
  Parameter,

  // Property/field (identifier after `.`)
  Property,
}

export interface DoofToken {
  kind: DoofTokenKind;
  line: number;   // 0-based
  col: number;    // 0-based
  length: number;
}

const CONTROL_KEYWORDS = new Set([
  "if", "else", "then", "while", "for", "of", "return", "break", "continue",
  "case", "try", "catch", "panic", "with", "import", "export", "from", "as",
  "implements",
]);

const STORAGE_KEYWORDS = new Set([
  "const", "readonly", "let", "function", "class", "interface", "enum", "type",
  "destructor",
]);

const STORAGE_MODIFIERS = new Set([
  "static", "private", "export", "isolated", "async", "weak",
]);

const PRIMITIVE_TYPES = new Set([
  "byte", "int", "long", "float", "double", "string", "char", "bool", "void",
]);

const BUILTIN_TYPES = new Set([
  "Array", "ReadonlyArray", "Map", "ReadonlyMap", "Set", "ReadonlySet",
  "Tuple", "Result", "Success", "Failure", "Actor", "Future", "ParseError",
]);

export function tokenize(source: string): DoofToken[] {
  const tokens: DoofToken[] = [];
  let pos = 0;
  let line = 0;
  let col = 0;

  // Track state for contextual classification
  let prevIdentKind: DoofTokenKind | null = null;
  let parenDepth = 0;
  let inParamList = false;

  function peek(offset = 0): string {
    return source[pos + offset] ?? "\0";
  }

  function advance(): string {
    const ch = source[pos++];
    if (ch === "\n") { line++; col = 0; } else { col++; }
    return ch;
  }

  function emit(kind: DoofTokenKind, startLine: number, startCol: number, length: number) {
    tokens.push({ kind, line: startLine, col: startCol, length });
  }

  function isDigit(ch: string) { return ch >= "0" && ch <= "9"; }
  function isIdentStart(ch: string) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }
  function isIdentPart(ch: string) { return isIdentStart(ch) || isDigit(ch); }
  function isUpperCase(ch: string) { return ch >= "A" && ch <= "Z"; }

  // For template literal nesting
  let templateDepth = 0;
  const braceDepth: number[] = [];
  const templateDelimiters: string[] = [];

  while (pos < source.length) {
    // Skip whitespace
    const ch = peek();
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Template continuation when closing ${}
    if (templateDepth > 0 && ch === "}" && braceDepth.length > 0 &&
        braceDepth[braceDepth.length - 1] === 0) {
      braceDepth.pop();
      advance(); // consume }
      readTemplateContinuation();
      continue;
    }

    // Line comment
    if (ch === "/" && peek(1) === "/") {
      const startLine = line, startCol = col;
      const startPos = pos;
      while (pos < source.length && peek() !== "\n") advance();
      emit(DoofTokenKind.LineComment, startLine, startCol, pos - startPos);
      continue;
    }

    // Block comment
    if (ch === "/" && peek(1) === "*") {
      const startLine = line, startCol = col, startPos = pos;
      advance(); advance(); // /*
      while (pos < source.length) {
        if (peek() === "*" && peek(1) === "/") { advance(); advance(); break; }
        advance();
      }
      emit(DoofTokenKind.BlockComment, startLine, startCol, pos - startPos);
      continue;
    }

    // String literal
    if (ch === '"') {
      readInterpolatedString('"');
      continue;
    }

    // Template literal
    if (ch === "`") {
      readTemplateLiteral();
      continue;
    }

    // Char literal
    if (ch === "'") {
      const startLine = line, startCol = col, startPos = pos;
      advance(); // opening '
      if (peek() === "\\") { advance(); advance(); } else if (peek() !== "'") { advance(); }
      if (pos < source.length && peek() === "'") advance(); // closing '
      emit(DoofTokenKind.CharLiteral, startLine, startCol, pos - startPos);
      continue;
    }

    // Numbers
    if (isDigit(ch)) {
      const startLine = line, startCol = col, startPos = pos;
      let kind = DoofTokenKind.IntLiteral;

      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        advance(); advance();
        while (pos < source.length && /[0-9a-fA-F_]/.test(peek())) advance();
      } else if (ch === "0" && (peek(1) === "b" || peek(1) === "B")) {
        advance(); advance();
        while (pos < source.length && (peek() === "0" || peek() === "1" || peek() === "_")) advance();
      } else {
        while (pos < source.length && (isDigit(peek()) || peek() === "_")) advance();
        if (peek() === "." && peek(1) !== "." && peek(1) !== "<") {
          advance();
          while (pos < source.length && (isDigit(peek()) || peek() === "_")) advance();
          if (peek() === "e" || peek() === "E") {
            advance();
            if (peek() === "+" || peek() === "-") advance();
            while (pos < source.length && isDigit(peek())) advance();
          }
          kind = (peek() === "f" || peek() === "F")
            ? (advance(), DoofTokenKind.FloatLiteral)
            : DoofTokenKind.DoubleLiteral;
          emit(kind, startLine, startCol, pos - startPos);
          continue;
        }
      }

      if (peek() === "L" || peek() === "l") { advance(); kind = DoofTokenKind.LongLiteral; }
      else if (peek() === "f" || peek() === "F") { advance(); kind = DoofTokenKind.FloatLiteral; }
      emit(kind, startLine, startCol, pos - startPos);
      continue;
    }

    // Identifiers & keywords
    if (isIdentStart(ch)) {
      const startLine = line, startCol = col, startPos = pos;
      while (pos < source.length && isIdentPart(peek())) advance();
      const value = source.slice(startPos, pos);
      const len = pos - startPos;

      // Handle try! and try?
      if (value === "try" && (peek() === "!" || peek() === "?")) {
        advance();
        emit(DoofTokenKind.Keyword, startLine, startCol, len + 1);
        continue;
      }

      // Classify the identifier
      if (value === "true" || value === "false") {
        emit(DoofTokenKind.BooleanLiteral, startLine, startCol, len);
      } else if (value === "null") {
        emit(DoofTokenKind.NullLiteral, startLine, startCol, len);
      } else if (value === "this") {
        emit(DoofTokenKind.ThisKeyword, startLine, startCol, len);
      } else if (PRIMITIVE_TYPES.has(value)) {
        emit(DoofTokenKind.TypeKeyword, startLine, startCol, len);
      } else if (CONTROL_KEYWORDS.has(value)) {
        emit(DoofTokenKind.Keyword, startLine, startCol, len);
      } else if (STORAGE_KEYWORDS.has(value)) {
        // Check for definition patterns: `function name`, `class Name`, etc.
        const storageKw = value;
        emit(DoofTokenKind.StorageKeyword, startLine, startCol, len);

        if (storageKw === "function" || storageKw === "class" || storageKw === "interface" ||
            storageKw === "enum" || storageKw === "type") {
          // Look ahead for the name
          skipWhitespace();
          if (pos < source.length && isIdentStart(peek())) {
            const nameStartLine = line, nameStartCol = col, nameStartPos = pos;
            while (pos < source.length && isIdentPart(peek())) advance();
            const nameLen = pos - nameStartPos;
            const defKind = storageKw === "function" ? DoofTokenKind.FunctionDef
              : storageKw === "class" ? DoofTokenKind.ClassDef
              : storageKw === "interface" ? DoofTokenKind.InterfaceDef
              : storageKw === "enum" ? DoofTokenKind.EnumDef
              : DoofTokenKind.TypeAliasDef;
            emit(defKind, nameStartLine, nameStartCol, nameLen);

            // After function def, mark that we're about to enter param list
            if (storageKw === "function") {
              inParamList = true;
            }
          }
        }
        continue;
      } else if (STORAGE_MODIFIERS.has(value)) {
        emit(DoofTokenKind.StorageModifier, startLine, startCol, len);
      } else if (BUILTIN_TYPES.has(value)) {
        emit(DoofTokenKind.BuiltinType, startLine, startCol, len);
      } else {
        // Contextual classification
        // Check what follows: `(` means function call, otherwise check context
        skipWhitespace();
        const next = peek();

        if (next === "(") {
          emit(DoofTokenKind.FunctionCall, startLine, startCol, len);
        } else if (isUpperCase(value[0])) {
          // PascalCase identifiers are likely type references
          emit(DoofTokenKind.TypeReference, startLine, startCol, len);
        } else if (inParamList && parenDepth > 0) {
          // Inside a parameter list: check if this is a parameter name
          // Parameters are identifiers that are followed by `:` or `,`
          if (next === ":" || next === ",") {
            emit(DoofTokenKind.Parameter, startLine, startCol, len);
          } else {
            emit(DoofTokenKind.Identifier, startLine, startCol, len);
          }
        } else {
          // Check if this is after a `.` — property access
          const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
          if (prevToken && prevToken.kind === DoofTokenKind.Punctuation) {
            // Check if the previous punctuation was a dot
            const prevChar = source[prevToken.col + (prevToken.line === startLine ? 0 : 0)];
            // Actually, better to check directly from the emit
            emit(DoofTokenKind.Identifier, startLine, startCol, len);
          } else {
            emit(DoofTokenKind.Identifier, startLine, startCol, len);
          }
        }
      }
      continue;
    }

    // Operators and punctuation
    const startLine = line, startCol = col, startPos = pos;

    if (ch === "(") {
      advance();
      parenDepth++;
      emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
    } else if (ch === ")") {
      advance();
      parenDepth--;
      if (parenDepth === 0) inParamList = false;
      emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
    } else if (ch === "{") {
      advance();
      if (braceDepth.length > 0) braceDepth[braceDepth.length - 1]++;
      emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
    } else if (ch === "}") {
      advance();
      if (braceDepth.length > 0) braceDepth[braceDepth.length - 1]--;
      emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
    } else if (ch === "[" || ch === "]" || ch === "," || ch === ";" || ch === "~") {
      advance();
      emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
    } else if (ch === ".") {
      if (peek(1) === "." && peek(2) === ".") {
        advance(); advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 3);
      } else if (peek(1) === "." && peek(2) === "<") {
        advance(); advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 3);
      } else if (peek(1) === ".") {
        advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 2);
      } else {
        advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 1);
      }
    } else if (ch === ":") {
      if (peek(1) === "=") {
        advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 2);
      } else {
        advance();
        emit(DoofTokenKind.Punctuation, startLine, startCol, 1);
      }
    } else {
      // Multi-char operators
      const twoChar = source.slice(pos, pos + 2);
      const threeChar = source.slice(pos, pos + 3);

      if (threeChar === ">>>" || threeChar === "**=" || threeChar === "<<=" ||
          threeChar === ">>=" || threeChar === "??=") {
        advance(); advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 3);
      } else if (twoChar === "==" || twoChar === "!=" || twoChar === "<=" ||
                 twoChar === ">=" || twoChar === "&&" || twoChar === "||" ||
                 twoChar === "**" || twoChar === "??" || twoChar === "=>" ||
                 twoChar === "+=" || twoChar === "-=" || twoChar === "*=" ||
                 twoChar === "/=" || twoChar === "%=" || twoChar === "&=" ||
                 twoChar === "|=" || twoChar === "^=" || twoChar === "<<" ||
                 twoChar === ">>" || twoChar === "?." || twoChar === "!." ||
                 twoChar === "\\=") {
        advance(); advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 2);
      } else {
        advance();
        emit(DoofTokenKind.Operator, startLine, startCol, 1);
      }
    }
  }

  function skipWhitespace() {
    while (pos < source.length) {
      const c = peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") advance();
      else break;
    }
  }

  function readInterpolatedString(delimiter: string) {
    const startLine = line, startCol = col, startPos = pos;
    advance(); // opening quote

    while (pos < source.length && peek() !== delimiter) {
      if (peek() === "$" && peek(1) === "{") {
        emit(DoofTokenKind.TemplateHead, startLine, startCol, pos - startPos);
        advance(); advance(); // ${
        templateDepth++;
        braceDepth.push(0);
        templateDelimiters.push(delimiter);
        return;
      }
      if (peek() === "\\") { advance(); advance(); } else { advance(); }
    }

    if (pos < source.length) advance(); // closing quote
    emit(DoofTokenKind.StringLiteral, startLine, startCol, pos - startPos);
  }

  function readTemplateLiteral() {
    readInterpolatedString("`");
  }

  function readTemplateContinuation() {
    const startLine = line, startCol = col, startPos = pos;
    const delimiter = templateDelimiters[templateDelimiters.length - 1] ?? "`";

    while (pos < source.length && peek() !== delimiter) {
      if (peek() === "$" && peek(1) === "{") {
        emit(DoofTokenKind.TemplateHead, startLine, startCol, pos - startPos);
        advance(); advance(); // ${
        braceDepth.push(0);
        return;
      }
      if (peek() === "\\") { advance(); advance(); } else { advance(); }
    }

    if (pos < source.length) advance(); // closing quote
    templateDepth--;
    templateDelimiters.pop();
    emit(DoofTokenKind.TemplateTail, startLine, startCol, pos - startPos);
  }

  return tokens;
}
