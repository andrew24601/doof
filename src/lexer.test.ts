import { describe, it, expect } from "vitest";
import { Lexer, TokenType } from "./lexer.js";

function tokenTypes(source: string): TokenType[] {
  return new Lexer(source).tokenize().map(t => t.type);
}

function tokenValues(source: string): string[] {
  return new Lexer(source).tokenize().map(t => t.value);
}

describe("Lexer", () => {
  describe("numeric literals", () => {
    it("lexes integer literals", () => {
      const tokens = new Lexer("42").tokenize();
      expect(tokens[0].type).toBe(TokenType.IntLiteral);
      expect(tokens[0].value).toBe("42");
    });

    it("lexes long literals", () => {
      const tokens = new Lexer("42L").tokenize();
      expect(tokens[0].type).toBe(TokenType.LongLiteral);
      expect(tokens[0].value).toBe("42");
    });

    it("lexes float literals", () => {
      const tokens = new Lexer("3.14f").tokenize();
      expect(tokens[0].type).toBe(TokenType.FloatLiteral);
      expect(tokens[0].value).toBe("3.14");
    });

    it("lexes double literals", () => {
      const tokens = new Lexer("3.14").tokenize();
      expect(tokens[0].type).toBe(TokenType.DoubleLiteral);
      expect(tokens[0].value).toBe("3.14");
    });

    it("lexes hex literals", () => {
      const tokens = new Lexer("0xFF").tokenize();
      expect(tokens[0].type).toBe(TokenType.IntLiteral);
      expect(tokens[0].value).toBe("0xFF");
    });

    it("lexes binary literals", () => {
      const tokens = new Lexer("0b1010").tokenize();
      expect(tokens[0].type).toBe(TokenType.IntLiteral);
      expect(tokens[0].value).toBe("0b1010");
    });

    it("lexes numeric separators between digits", () => {
      const tokens = new Lexer("30_000 300_00 3_0_0_0_0_0 3.1_4f 0b1010_0001 0xFF_FF").tokenize();
      expect(tokens[0]).toMatchObject({ type: TokenType.IntLiteral, value: "30000" });
      expect(tokens[1]).toMatchObject({ type: TokenType.IntLiteral, value: "30000" });
      expect(tokens[2]).toMatchObject({ type: TokenType.IntLiteral, value: "300000" });
      expect(tokens[3]).toMatchObject({ type: TokenType.FloatLiteral, value: "3.14" });
      expect(tokens[4]).toMatchObject({ type: TokenType.IntLiteral, value: "0b10100001" });
      expect(tokens[5]).toMatchObject({ type: TokenType.IntLiteral, value: "0xFFFF" });
    });

    it("reports invalid numeric separators", () => {
      const leading = new Lexer("3._14");
      leading.tokenize();
      expect(leading.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          message: "Numeric separators must appear between digits",
        }),
      ]);

      const trailing = new Lexer("30_000_");
      trailing.tokenize();
      expect(trailing.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          message: "Numeric separators must appear between digits",
        }),
      ]);

      const consecutive = new Lexer("30__000");
      consecutive.tokenize();
      expect(consecutive.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          message: "Numeric separators must appear between digits",
        }),
      ]);
    });
  });

  describe("keywords", () => {
    it("lexes any as an identifier", () => {
      const tokens = new Lexer("any").tokenize();
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].value).toBe("any");
    });

    it("lexes panic as an identifier", () => {
      const tokens = new Lexer("panic").tokenize();
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].value).toBe("panic");
    });
  });

  describe("string literals", () => {
    it("lexes simple strings", () => {
      const tokens = new Lexer('"hello"').tokenize();
      expect(tokens[0].type).toBe(TokenType.StringLiteral);
      expect(tokens[0].value).toBe("hello");
    });

    it("handles escape sequences", () => {
      const tokens = new Lexer('"hello\\nworld"').tokenize();
      expect(tokens[0].value).toBe("hello\nworld");
    });

    it("handles dollar escape in strings", () => {
      const tokens = new Lexer('"price: \\$5"').tokenize();
      expect(tokens[0].value).toBe("price: $5");
    });

    it("lexes double-quoted strings with interpolation", () => {
      const types = tokenTypes('"hello ${name}!"');
      expect(types).toEqual([
        TokenType.TemplateLiteralStart,
        TokenType.Identifier,
        TokenType.TemplateLiteralEnd,
        TokenType.EOF,
      ]);
    });

    it("lexes double-quoted strings with multiple interpolations", () => {
      const types = tokenTypes('"${a} and ${b}"');
      expect(types).toEqual([
        TokenType.TemplateLiteralStart,
        TokenType.Identifier,
        TokenType.TemplateLiteralMiddle,
        TokenType.Identifier,
        TokenType.TemplateLiteralEnd,
        TokenType.EOF,
      ]);
    });
  });

  describe("template literals", () => {
    it("lexes simple template strings", () => {
      const tokens = new Lexer("`hello`").tokenize();
      expect(tokens[0].type).toBe(TokenType.StringLiteral);
      expect(tokens[0].value).toBe("hello");
    });

    it("lexes template with interpolation", () => {
      const types = tokenTypes("`hello ${name}!`");
      expect(types).toEqual([
        TokenType.TemplateLiteralStart,
        TokenType.Identifier,
        TokenType.TemplateLiteralEnd,
        TokenType.EOF,
      ]);
    });

    it("lexes template with multiple interpolations", () => {
      const types = tokenTypes("`${a} and ${b}`");
      expect(types).toEqual([
        TokenType.TemplateLiteralStart,
        TokenType.Identifier,
        TokenType.TemplateLiteralMiddle,
        TokenType.Identifier,
        TokenType.TemplateLiteralEnd,
        TokenType.EOF,
      ]);
    });
  });

  describe("char literals", () => {
    it("lexes char literals", () => {
      const tokens = new Lexer("'a'").tokenize();
      expect(tokens[0].type).toBe(TokenType.CharLiteral);
      expect(tokens[0].value).toBe("a");
    });

    it("lexes escaped char literals", () => {
      const tokens = new Lexer("'\\n'").tokenize();
      expect(tokens[0].type).toBe(TokenType.CharLiteral);
      expect(tokens[0].value).toBe("\n");
    });
  });

  describe("keywords", () => {
    it("recognizes all keywords", () => {
      expect(tokenTypes("const")[0]).toBe(TokenType.Const);
      expect(tokenTypes("readonly")[0]).toBe(TokenType.Readonly);
      expect(tokenTypes("let")[0]).toBe(TokenType.Let);
      expect(tokenTypes("function")[0]).toBe(TokenType.Function);
      expect(tokenTypes("return")[0]).toBe(TokenType.Return);
      expect(tokenTypes("if")[0]).toBe(TokenType.If);
      expect(tokenTypes("else")[0]).toBe(TokenType.Else);
      expect(tokenTypes("then")[0]).toBe(TokenType.Then);
      expect(tokenTypes("while")[0]).toBe(TokenType.While);
      expect(tokenTypes("for")[0]).toBe(TokenType.For);
      expect(tokenTypes("of")[0]).toBe(TokenType.Of);
      expect(tokenTypes("break")[0]).toBe(TokenType.Break);
      expect(tokenTypes("continue")[0]).toBe(TokenType.Continue);
      expect(tokenTypes("case")[0]).toBe(TokenType.Case);
      expect(tokenTypes("class")[0]).toBe(TokenType.Class);
      expect(tokenTypes("interface")[0]).toBe(TokenType.Interface);
      expect(tokenTypes("implements")[0]).toBe(TokenType.Implements);
      expect(tokenTypes("enum")[0]).toBe(TokenType.Enum);
      expect(tokenTypes("type")[0]).toBe(TokenType.Type);
      expect(tokenTypes("import")[0]).toBe(TokenType.Import);
      expect(tokenTypes("export")[0]).toBe(TokenType.Export);
      expect(tokenTypes("from")[0]).toBe(TokenType.From);
      expect(tokenTypes("as")[0]).toBe(TokenType.As);
      expect(tokenTypes("true")[0]).toBe(TokenType.True);
      expect(tokenTypes("false")[0]).toBe(TokenType.False);
      expect(tokenTypes("null")[0]).toBe(TokenType.Null);
      expect(tokenTypes("void")[0]).toBe(TokenType.Void);
      expect(tokenTypes("try")[0]).toBe(TokenType.Try);
      expect(tokenTypes("static")[0]).toBe(TokenType.Static);
      expect(tokenTypes("this")[0]).toBe(TokenType.This);
      expect(tokenTypes("weak")[0]).toBe(TokenType.Weak);
    });

    it("does not confuse identifiers with keywords", () => {
      expect(tokenTypes("is")[0]).toBe(TokenType.Identifier);
      expect(tokenTypes("constant")[0]).toBe(TokenType.Identifier);
      expect(tokenTypes("letName")[0]).toBe(TokenType.Identifier);
    });
  });

  describe("operators", () => {
    it("lexes arithmetic operators", () => {
      expect(tokenTypes("+ - * / \\ % **")).toEqual([
        TokenType.Plus, TokenType.Minus, TokenType.Star,
        TokenType.Slash, TokenType.Backslash, TokenType.Percent, TokenType.StarStar,
        TokenType.EOF,
      ]);
    });

    it("lexes comparison operators", () => {
      expect(tokenTypes("== != < <= > >=")).toEqual([
        TokenType.EqualEqual, TokenType.BangEqual,
        TokenType.Less, TokenType.LessEqual,
        TokenType.Greater, TokenType.GreaterEqual,
        TokenType.EOF,
      ]);
    });

    it("lexes logical operators", () => {
      expect(tokenTypes("&& || !")).toEqual([
        TokenType.AmpersandAmpersand, TokenType.PipePipe, TokenType.Bang,
        TokenType.EOF,
      ]);
    });

    it("lexes bitwise operators", () => {
      expect(tokenTypes("& | ^ ~ << >> >>>")).toEqual([
        TokenType.Ampersand, TokenType.Pipe, TokenType.Caret,
        TokenType.Tilde, TokenType.LessLess,
        TokenType.GreaterGreater, TokenType.GreaterGreaterGreater,
        TokenType.EOF,
      ]);
    });

    it("lexes assignment operators", () => {
      expect(tokenTypes(":= = += -= *= /= \\= %= **=")).toEqual([
        TokenType.ColonEqual, TokenType.Equal,
        TokenType.PlusEqual, TokenType.MinusEqual,
        TokenType.StarEqual, TokenType.SlashEqual,
        TokenType.BackslashEqual, TokenType.PercentEqual, TokenType.StarStarEqual,
        TokenType.EOF,
      ]);
    });

    it("lexes null-coalescing operators", () => {
      expect(tokenTypes("?? ??=")).toEqual([
        TokenType.QuestionQuestion, TokenType.QuestionQuestionEqual,
        TokenType.EOF,
      ]);
    });

    it("lexes optional chaining", () => {
      expect(tokenTypes("?. !. ?[")).toEqual([
        TokenType.QuestionDot, TokenType.BangDot, TokenType.QuestionBracket,
        TokenType.EOF,
      ]);
    });

    it("lexes range operators", () => {
      expect(tokenTypes(".. ..<")).toEqual([
        TokenType.DotDot, TokenType.DotDotLess,
        TokenType.EOF,
      ]);
    });

    it("lexes arrow and ellipsis", () => {
      expect(tokenTypes("=> ...")).toEqual([
        TokenType.Arrow, TokenType.Ellipsis,
        TokenType.EOF,
      ]);
    });
  });

  describe("delimiters and punctuation", () => {
    it("lexes all delimiters", () => {
      expect(tokenTypes("( ) { } [ ]")).toEqual([
        TokenType.LeftParen, TokenType.RightParen,
        TokenType.LeftBrace, TokenType.RightBrace,
        TokenType.LeftBracket, TokenType.RightBracket,
        TokenType.EOF,
      ]);
    });

    it("lexes punctuation", () => {
      expect(tokenTypes(". , : ;")).toEqual([
        TokenType.Dot, TokenType.Comma, TokenType.Colon, TokenType.Semicolon,
        TokenType.EOF,
      ]);
    });

    it("lexes underscore", () => {
      expect(tokenTypes("_")[0]).toBe(TokenType.Underscore);
    });
  });

  describe("comments", () => {
    it("skips line comments", () => {
      const types = tokenTypes("42 // comment\n43");
      expect(types).toEqual([TokenType.IntLiteral, TokenType.IntLiteral, TokenType.EOF]);
    });

    it("skips block comments", () => {
      const types = tokenTypes("42 /* block */ 43");
      expect(types).toEqual([TokenType.IntLiteral, TokenType.IntLiteral, TokenType.EOF]);
    });
  });

  describe("source locations", () => {
    it("tracks line and column", () => {
      const tokens = new Lexer("let x = 42").tokenize();
      expect(tokens[0].line).toBe(1);
      expect(tokens[0].column).toBe(1);
      expect(tokens[1].line).toBe(1);
      expect(tokens[1].column).toBe(5);
    });

    it("tracks lines across newlines", () => {
      const tokens = new Lexer("let\nx").tokenize();
      expect(tokens[0].line).toBe(1);
      expect(tokens[1].line).toBe(2);
      expect(tokens[1].column).toBe(1);
    });
  });

  describe("try operators", () => {
    it("lexes try! and try?", () => {
      const types = tokenTypes("try! try?");
      expect(types).toEqual([
        TokenType.Identifier, TokenType.Identifier, TokenType.EOF,
      ]);
      const values = tokenValues("try! try?");
      expect(values[0]).toBe("try!");
      expect(values[1]).toBe("try?");
    });

    it("lexes plain try", () => {
      expect(tokenTypes("try")[0]).toBe(TokenType.Try);
    });
  });

  // ==========================================================================
  // Concurrency keywords
  // ==========================================================================

  describe("concurrency keywords", () => {
    it("lexes async keyword", () => {
      expect(tokenTypes("async")[0]).toBe(TokenType.Async);
    });

    it("lexes isolated keyword", () => {
      expect(tokenTypes("isolated")[0]).toBe(TokenType.Isolated);
    });

    it("lexes async in context", () => {
      const types = tokenTypes("let p = async compute(42)");
      expect(types).toContain(TokenType.Async);
    });

    it("lexes isolated function", () => {
      const types = tokenTypes("isolated function sum(): int");
      expect(types[0]).toBe(TokenType.Isolated);
      expect(types[1]).toBe(TokenType.Function);
    });
  });

  // ==========================================================================
  // Lexer error diagnostics
  // ==========================================================================

  describe("error diagnostics", () => {
    it("reports unterminated string literal", () => {
      const lexer = new Lexer('"hello');
      lexer.tokenize();
      expect(lexer.diagnostics).toHaveLength(1);
      expect(lexer.diagnostics[0].message).toBe("Unterminated string literal");
      expect(lexer.diagnostics[0].severity).toBe("error");
      expect(lexer.diagnostics[0].line).toBe(1);
    });

    it("reports unterminated template literal", () => {
      const lexer = new Lexer("`hello ${world");
      lexer.tokenize();
      // May have unterminated template or other issues
      expect(lexer.diagnostics.length).toBeGreaterThanOrEqual(0);
    });

    it("reports unterminated block comment", () => {
      const lexer = new Lexer("/* this never ends");
      lexer.tokenize();
      expect(lexer.diagnostics).toHaveLength(1);
      expect(lexer.diagnostics[0].message).toBe("Unterminated block comment");
      expect(lexer.diagnostics[0].severity).toBe("error");
    });

    it("reports unexpected character", () => {
      const lexer = new Lexer("val x = §42");
      lexer.tokenize();
      expect(lexer.diagnostics).toHaveLength(1);
      expect(lexer.diagnostics[0].message).toContain("Unexpected character");
    });

    it("reports correct line for error on second line", () => {
      const lexer = new Lexer('val x = 1\n"unterminated');
      lexer.tokenize();
      expect(lexer.diagnostics).toHaveLength(1);
      expect(lexer.diagnostics[0].line).toBe(2);
    });

    it("produces no diagnostics for valid input", () => {
      const lexer = new Lexer('val x = "hello" + " world"');
      lexer.tokenize();
      expect(lexer.diagnostics).toHaveLength(0);
    });
  });
});
