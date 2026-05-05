import { Lexer, Token, TokenType, type LexerDiagnostic } from "./lexer.js";
import type {
  Program, Statement, Expression, Block, TypeAnnotation,
  NamedType,
  Parameter, ClassField, InterfaceField, InterfaceMethod,
  EnumVariant, CaseArm, CasePattern, CallArgument,
  ObjectProperty, ImportSpecifier, ExportSpecifier,
  BinaryOperator, UnaryOperator, AssignmentOperator,
  SourceSpan, SourceLocation, DestructureBinding,
  FunctionDeclaration, MapEntry,
  ExternClassField, ExternClassMethod, ExternFunctionDeclaration,
  AsyncExpression, ActorCreationExpression, CatchExpression,
  LambdaExpression, CallExpression, YieldBlockExpression,
} from "./ast.js";

type CaseForm = "expression" | "statement";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`Parse error at ${line}:${column}: ${message}`);
    this.name = "ParseError";
  }
}

export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;
  private inCaseSubject: boolean = false;
  private inStatementCaseArmExpression: boolean = false;
  private statementCaseArmExpressionLine: number = 0;
  /** When true, a `{` after `)` on the same line is consumed as a trailing lambda. */
  private allowTrailingLambda: boolean = false;
  /** Diagnostics produced by the lexer during tokenization. */
  public lexerDiagnostics: LexerDiagnostic[] = [];

  parse(source: string): Program {
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
    this.lexerDiagnostics = lexer.diagnostics;
    this.pos = 0;

    const startLoc = this.loc();
    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      statements.push(this.parseStatement());
    }

    return {
      kind: "program",
      statements,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private current(): Token {
    return this.tokens[this.pos];
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[idx];
  }

  private advance(): Token {
    const tok = this.current();
    if (!this.isAtEnd()) this.pos++;
    return tok;
  }

  private expect(type: TokenType, message?: string): Token {
    if (this.current().type !== type) {
      const tok = this.current();
      throw new ParseError(
        message ?? `Expected ${type} but got ${tok.type} ('${tok.value}')`,
        tok.line,
        tok.column,
      );
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    if (types.includes(this.current().type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.current().type);
  }

  private loc(): SourceLocation {
    const tok = this.current();
    return { line: tok.line, column: tok.column, offset: tok.offset };
  }

  private span(start: SourceLocation): SourceSpan {
    const prev = this.tokens[this.pos - 1] ?? this.current();
    return {
      start,
      end: {
        line: prev.line,
        column: prev.column + prev.value.length,
        offset: prev.offset + prev.value.length,
      },
    };
  }

  private error(message: string): ParseError {
    const tok = this.current();
    return new ParseError(message, tok.line, tok.column);
  }

  private isCurrentTokenOnSameLineAsPrevious(): boolean {
    const prev = this.tokens[this.pos - 1];
    return !!prev && prev.line === this.current().line;
  }

  private isCurrentTokenImmediatelyAfterPrevious(): boolean {
    const prev = this.tokens[this.pos - 1];
    return !!prev && prev.offset + prev.value.length === this.current().offset;
  }

  // ===========================================================================
  // Statements
  // ===========================================================================

  private parseStatement(): Statement {
    // Handle exported declarations
    if (this.check(TokenType.Export)) {
      return this.parseExport();
    }

    // Mock declarations and directives
    if (this.check(TokenType.Mock)) {
      return this.parseMockStatement();
    }

    // Import
    if (this.check(TokenType.Import)) {
      return this.parseImport();
    }

    // Const
    if (this.check(TokenType.Const)) {
      return this.parseConstDeclaration(false);
    }

    // Readonly
    if (this.check(TokenType.Readonly)) {
      return this.parseReadonlyDeclaration(false);
    }

    // Let
    if (this.check(TokenType.Let)) {
      return this.parseLetDeclaration();
    }

    // Function
    if (this.check(TokenType.Function)) {
      return this.parseFunctionDeclaration(false, false, false, false);
    }

    // Isolated function
    if (this.check(TokenType.Isolated)) {
      if (this.peek(1).type === TokenType.Function) {
        this.advance(); // consume 'isolated'
        return this.parseFunctionDeclaration(false, false, true, false);
      }
    }

    // Class
    if (this.check(TokenType.Class)) {
      return this.parseClassDeclaration(false, false);
    }

    // Private declarations
    if (this.check(TokenType.Private)) {
      const next = this.peek(1).type;
      if (next === TokenType.Function) {
        this.advance(); // consume 'private'
        return this.parseFunctionDeclaration(false, false, false, true);
      }
      if (next === TokenType.Isolated && this.peek(2).type === TokenType.Function) {
        this.advance(); // consume 'private'
        this.advance(); // consume 'isolated'
        return this.parseFunctionDeclaration(false, false, true, true);
      }
      if (next === TokenType.Class) {
        this.advance(); // consume 'private'
        return this.parseClassDeclaration(false, true);
      }
      throw this.error(`Unexpected token after private: ${next}`);
    }

    // Interface
    if (this.check(TokenType.Interface)) {
      return this.parseInterfaceDeclaration(false);
    }

    // Enum
    if (this.check(TokenType.Enum)) {
      return this.parseEnumDeclaration(false);
    }

    // Type alias
    if (this.check(TokenType.Type)) {
      return this.parseTypeAlias(false);
    }

    // Return
    if (this.check(TokenType.Return)) {
      return this.parseReturnStatement();
    }

    // Yield
    if (this.check(TokenType.Yield)) {
      return this.parseYieldStatement();
    }

    // If statement
    if (this.check(TokenType.If)) {
      return this.parseIfStatement();
    }

    // While
    if (this.check(TokenType.While)) {
      return this.parseWhileStatement(null);
    }

    // For
    if (this.check(TokenType.For)) {
      return this.parseForStatement(null);
    }

    // With (scoped bindings)
    if (this.check(TokenType.With)) {
      return this.parseWithStatement();
    }

    // Break
    if (this.check(TokenType.Break)) {
      return this.parseBreakStatement();
    }

    // Continue
    if (this.check(TokenType.Continue)) {
      return this.parseContinueStatement();
    }

    // Case statement
    if (this.check(TokenType.Case)) {
      return this.parseCaseStatement();
    }

    // Try statement: try <binding>
    if (this.check(TokenType.Try)) {
      return this.parseTryStatement();
    }

    // Labeled statement (identifier followed by colon then for/while)
    if (
      this.check(TokenType.Identifier) &&
      this.peek(1).type === TokenType.Colon &&
      (this.peek(2).type === TokenType.For || this.peek(2).type === TokenType.While)
    ) {
      return this.parseLabeledStatement();
    }

    // Array destructuring: [a, b] := expr  or  let [a, b] = expr
    // Destructuring: (a, b) := expr  or  let (a, b) = expr
    // Named destructuring: { a, b } := expr  or  let { a, b } = expr
    if (this.check(TokenType.LeftBracket) && this.looksLikeArrayDestructuring(TokenType.ColonEqual)) {
      return this.parseArrayDestructuring("immutable");
    }
    if (this.check(TokenType.LeftParen) && this.looksLikePositionalDestructuring(TokenType.ColonEqual)) {
      return this.parsePositionalDestructuring("immutable");
    }
    if (this.check(TokenType.LeftBrace) && this.looksLikeNamedDestructuring(TokenType.ColonEqual)) {
      return this.parseNamedDestructuring("immutable");
    }
    if (this.check(TokenType.LeftBracket) && this.looksLikeArrayDestructuring(TokenType.Equal)) {
      return this.parseArrayDestructuringAssignment();
    }
    if (this.check(TokenType.LeftParen) && this.looksLikePositionalDestructuring(TokenType.Equal)) {
      return this.parsePositionalDestructuringAssignment();
    }
    if (this.check(TokenType.LeftBrace) && this.looksLikeNamedDestructuring(TokenType.Equal)) {
      return this.parseNamedDestructuringAssignment();
    }

    // Bare block statements are not allowed — use 'with' for scoped bindings
    if (this.check(TokenType.LeftBrace)) {
      throw this.error("Unexpected '{' — bare block statements are not allowed; use 'with' for scoped bindings");
    }

    // Expression statement — may also be := binding
    return this.parseExpressionOrBinding();
  }

  private parseExpressionOrBinding(): Statement {
    const startLoc = this.loc();

    // Check for typed immutable binding: `name: Type := expr`
    if (this.check(TokenType.Identifier) && this.looksLikeTypedBinding()) {
      return this.parseTypedImmutableBinding();
    }

    // Enable trailing lambdas for expression-statements and bindings.
    // A trailing `{` on the same line as `)` is consumed as a lambda.
    const prevTrailingLambda = this.allowTrailingLambda;
    this.allowTrailingLambda = true;
    try {

    const expr = this.parseExpression();

    if (this.check(TokenType.LeftArrow)) {
      this.advance();
      if (expr.kind !== "identifier") {
        throw this.error("Left side of <- must be an identifier");
      }
      const value = this.parseYieldBlockExpression();
      this.consumeOptionalSemicolon();
      return {
        kind: "yield-block-assignment-statement",
        name: expr.name,
        value,
        span: this.span(startLoc),
      };
    }

    // Check for := (immutable binding)
    if (this.check(TokenType.ColonEqual)) {
      this.advance();
      if (expr.kind !== "identifier") {
        throw this.error("Left side of := must be an identifier");
      }
      const value = this.parseExpression();

      // Check for else-narrow: `x := expr else { ... }`
      if (this.check(TokenType.Else)) {
        this.advance();
        const elseBlock = this.parseBlock();
        this.consumeOptionalSemicolon();
        return {
          kind: "else-narrow-statement" as const,
          name: expr.name,
          type: null,
          subject: value,
          elseBlock,
          span: this.span(startLoc),
        };
      }

      this.consumeOptionalSemicolon();
      return {
        kind: "immutable-binding",
        name: expr.name,
        type: null,
        value,
        span: this.span(startLoc),
      };
    }

    // Check for assignment operators
    const assignOp = this.tryParseAssignmentOperator();
    if (assignOp) {
      const value = this.parseExpression();
      this.consumeOptionalSemicolon();
      return {
        kind: "expression-statement",
        expression: {
          kind: "assignment-expression",
          operator: assignOp,
          target: expr,
          value,
          span: this.span(startLoc),
        },
        span: this.span(startLoc),
      };
    }

    this.consumeOptionalSemicolon();
    return {
      kind: "expression-statement",
      expression: expr,
      span: this.span(startLoc),
    };

    } finally {
      this.allowTrailingLambda = prevTrailingLambda;
    }
  }

  private parseTypedImmutableBinding(): Statement {
    const startLoc = this.loc();
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Colon);
    const type = this.parseTypeAnnotation();
    this.expect(TokenType.ColonEqual);
    const prevTrailingLambda = this.allowTrailingLambda;
    this.allowTrailingLambda = true;
    const value = this.parseExpression();
    this.allowTrailingLambda = prevTrailingLambda;

    // Check for else-narrow: `x: Type := expr else { ... }`
    if (this.check(TokenType.Else)) {
      this.advance();
      const elseBlock = this.parseBlock();
      this.consumeOptionalSemicolon();
      return {
        kind: "else-narrow-statement" as const,
        name,
        type,
        subject: value,
        elseBlock,
        span: this.span(startLoc),
      };
    }

    this.consumeOptionalSemicolon();
    return {
      kind: "immutable-binding",
      name,
      type,
      value,
      span: this.span(startLoc),
    };
  }

  private looksLikeTypedBinding(): boolean {
    // identifier : Type :=
    // We need to scan ahead for := after a type annotation
    let i = 1;
    if (this.peek(i).type !== TokenType.Colon) return false;
    i++;
    // Skip type annotation tokens until we either find := or something that clearly isn't a type
    let depth = 0;
    while (true) {
      const t = this.peek(i);
      if (t.type === TokenType.EOF) return false;
      if (depth === 0 && t.type === TokenType.ColonEqual) return true;
      if (depth === 0 && (
        t.type === TokenType.Equal ||
        t.type === TokenType.LeftBrace ||
        t.type === TokenType.Semicolon
      )) {
        return false;
      }
      if (t.type === TokenType.Less) depth++;
      if (t.type === TokenType.Greater && depth > 0) depth--;
      if (t.type === TokenType.LeftBracket) depth++;
      if (t.type === TokenType.RightBracket && depth > 0) depth--;
      i++;
      if (i > 50) return false; // safety
    }
  }

  private tryParseAssignmentOperator(): AssignmentOperator | null {
    const type = this.current().type;
    const map: Partial<Record<TokenType, AssignmentOperator>> = {
      [TokenType.Equal]: "=",
      [TokenType.PlusEqual]: "+=",
      [TokenType.MinusEqual]: "-=",
      [TokenType.StarEqual]: "*=",
      [TokenType.SlashEqual]: "/=",
      [TokenType.BackslashEqual]: "\\=",
      [TokenType.PercentEqual]: "%=",
      [TokenType.StarStarEqual]: "**=",
      [TokenType.AmpersandEqual]: "&=",
      [TokenType.PipeEqual]: "|=",
      [TokenType.CaretEqual]: "^=",
      [TokenType.LessLessEqual]: "<<=",
      [TokenType.GreaterGreaterEqual]: ">>=",
      [TokenType.QuestionQuestionEqual]: "??=",
    };
    const op = map[type];
    if (op) {
      this.advance();
      return op;
    }
    return null;
  }

  private consumeOptionalSemicolon(): void {
    this.match(TokenType.Semicolon);
  }

  private shouldStopStatementCaseArmExpression(): boolean {
    return this.inStatementCaseArmExpression && this.current().line > this.statementCaseArmExpressionLine;
  }

  // ===========================================================================
  // Declarations
  // ===========================================================================

  /** Optionally consume a string literal used as a description on a declaration. */
  private parseDescription(): string | undefined {
    if (this.check(TokenType.StringLiteral)) {
      return this.advance().value;
    }
    return undefined;
  }

  private parseConstDeclaration(exported: boolean): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Const);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    const value = this.parseDeclarationInitializer();
    this.consumeOptionalSemicolon();

    return {
      kind: "const-declaration",
      name,
      description,
      type,
      value,
      exported,
      span: this.span(startLoc),
    };
  }

  private parseReadonlyDeclaration(exported: boolean): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Readonly);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    const value = this.parseDeclarationInitializer();
    this.consumeOptionalSemicolon();

    return {
      kind: "readonly-declaration",
      name,
      description,
      type,
      value,
      exported,
      span: this.span(startLoc),
    };
  }

  private parseLetDeclaration(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Let);

    // Check for destructuring: let [a, b] = expr  or  let (a, b) = expr  or  let { a, b } = expr
    if (this.check(TokenType.LeftBracket) && this.looksLikeArrayDestructuring(TokenType.Equal)) {
      return this.parseArrayDestructuring("let");
    }
    if (this.check(TokenType.LeftParen) && this.looksLikePositionalDestructuring(TokenType.Equal)) {
      return this.parsePositionalDestructuring("let");
    }
    if (this.check(TokenType.LeftBrace) && this.looksLikeNamedDestructuring(TokenType.Equal)) {
      return this.parseNamedDestructuring("let");
    }

    const name = this.expect(TokenType.Identifier).value;

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    const value = this.parseDeclarationInitializer();
    this.consumeOptionalSemicolon();

    return {
      kind: "let-declaration",
      name,
      type,
      value,
      span: this.span(startLoc),
    };
  }

  private parseMockStatement(): Statement {
    this.expect(TokenType.Mock);

    if (this.check(TokenType.Import)) {
      return this.parseMockImportDirective();
    }
    if (this.check(TokenType.Function)) {
      return this.parseFunctionDeclaration(false, false, false, false, true);
    }
    if (this.check(TokenType.Class)) {
      return this.parseClassDeclaration(false, false, true);
    }

    throw this.error(`Unexpected token after mock: ${this.current().type}`);
  }

  private parseDeclarationInitializer(): Expression {
    if (this.match(TokenType.Equal)) {
      return this.parseExpression();
    }
    if (this.match(TokenType.LeftArrow)) {
      return this.parseYieldBlockExpression();
    }
    throw this.error("Expected '=' or '<-' in declaration initializer");
  }

  private parseYieldBlockExpression(): YieldBlockExpression {
    const startLoc = this.loc();
    if (!this.check(TokenType.LeftBrace)) {
      throw this.error("Expected block after '<-'");
    }
    const body = this.parseBlock();
    return {
      kind: "yield-block-expression",
      body,
      span: this.span(startLoc),
    };
  }

  private parseFunctionDeclaration(exported: boolean, static_: boolean, isolated_: boolean = false, private__: boolean = false, mock_: boolean = false): FunctionDeclaration {
    const startLoc = this.loc();
    this.expect(TokenType.Function);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();

    this.expect(TokenType.LeftParen);
    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);

    let returnType: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      returnType = this.parseTypeAnnotation();
    }

    let body: Expression | Block;
    let bodyless = false;
    if (this.match(TokenType.Arrow)) {
      body = this.parseExpression();
      this.consumeOptionalSemicolon();
    } else if (mock_ && !this.check(TokenType.LeftBrace)) {
      body = {
        kind: "block",
        statements: [],
        span: this.span(startLoc),
      };
      bodyless = true;
      this.consumeOptionalSemicolon();
    } else {
      body = this.parseBlock();
    }

    return {
      kind: "function-declaration",
      name,
      description,
      typeParams,
      typeParamConstraints,
      params,
      returnType,
      body,
      mock_,
      bodyless,
      exported,
      static_,
      isolated_,
      private_: private__,
      span: this.span(startLoc),
    };
  }

  /** Parse optional type parameter list: `<T, U : Foo | Bar, V>`. */
  private parseTypeParams(): { names: string[]; constraints: (TypeAnnotation | null)[] } {
    const names: string[] = [];
    const constraints: (TypeAnnotation | null)[] = [];
    if (this.match(TokenType.Less)) {
      do {
        names.push(this.expect(TokenType.Identifier).value);
        let constraint: TypeAnnotation | null = null;
        if (this.match(TokenType.Colon)) {
          constraint = this.parseTypeAnnotation();
        }
        constraints.push(constraint);
      } while (this.match(TokenType.Comma));
      this.expect(TokenType.Greater);
    }
    return { names, constraints };
  }

  private skipTypeAnnotationTokens(offset: number): number {
    let index = offset;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;

    while (true) {
      const token = this.peek(index).type;
      if (token === TokenType.EOF) return -1;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0
        && (token === TokenType.Comma || token === TokenType.Greater)) {
        return index;
      }
      switch (token) {
        case TokenType.LeftParen:
          parenDepth++;
          break;
        case TokenType.RightParen:
          if (parenDepth === 0) return -1;
          parenDepth--;
          break;
        case TokenType.LeftBracket:
          bracketDepth++;
          break;
        case TokenType.RightBracket:
          if (bracketDepth === 0) return -1;
          bracketDepth--;
          break;
        case TokenType.LeftBrace:
          braceDepth++;
          break;
        case TokenType.RightBrace:
          if (braceDepth === 0) return -1;
          braceDepth--;
          break;
        case TokenType.Less:
          angleDepth++;
          break;
        case TokenType.Greater:
          if (angleDepth > 0) {
            angleDepth--;
          } else {
            return index;
          }
          break;
      }
      index++;
    }
  }

  private parseParameterList(): Parameter[] {
    const params: Parameter[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      params.push(this.parseParameter());
      if (!this.match(TokenType.Comma)) break;
    }
    return params;
  }

  private parseParameter(): Parameter {
    const startLoc = this.loc();

    // Support destructuring parameters: (x, y): Type or { name, age }: Type
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    let defaultValue: Expression | null = null;
    if (this.match(TokenType.Equal)) {
      defaultValue = this.parseExpression();
    }

    return { name, description, type, defaultValue, span: this.span(startLoc) };
  }

  // ===========================================================================
  // Classes
  // ===========================================================================

  private parseClassDeclaration(exported: boolean, private__: boolean = false, mock_: boolean = false): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Class);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();

    const implements_: NamedType[] = [];
    if (this.match(TokenType.Implements)) {
      implements_.push(this.parseNamedTypeReference());
      while (this.match(TokenType.Comma)) {
        implements_.push(this.parseNamedTypeReference());
      }
    }

    this.expect(TokenType.LeftBrace);

    const fields: ClassField[] = [];
    const methods: FunctionDeclaration[] = [];
    let destructor: Block | null = null;

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      // Check for 'private' modifier on members
      let memberPrivate = false;
      if (this.check(TokenType.Private)) {
        memberPrivate = true;
        this.advance(); // consume 'private'
      }

      if (!memberPrivate && this.check(TokenType.Destructor)) {
        this.advance();
        destructor = this.parseBlock();
      } else if (this.check(TokenType.Isolated) && this.peek(1).type === TokenType.Function) {
        this.advance(); // consume 'isolated'
        methods.push(this.parseFunctionDeclaration(false, false, true, memberPrivate, mock_));
      } else if (this.check(TokenType.Static) && this.peek(1).type === TokenType.Function) {
        this.advance(); // static
        methods.push(this.parseFunctionDeclaration(false, true, false, memberPrivate, mock_));
      } else if (this.check(TokenType.Function)) {
        methods.push(this.parseFunctionDeclaration(false, false, false, memberPrivate, mock_));
      } else if (this.check(TokenType.Isolated) && this.looksLikeMethodAt(1)) {
        this.advance(); // consume 'isolated'
        methods.push(this.parseShortMethodDeclaration(false, true, memberPrivate, mock_));
      } else if (this.looksLikeMethod()) {
        methods.push(this.parseShortMethodDeclaration(undefined, false, memberPrivate, mock_));
      } else {
        fields.push(this.parseClassField(memberPrivate));
      }
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "class-declaration",
      name,
      description,
      typeParams,
      typeParamConstraints,
      implements_,
      fields,
      methods,
      destructor,
      mock_,
      exported,
      private_: private__,
      span: this.span(startLoc),
    };
  }

  private looksLikeMethod(): boolean {
    return this.looksLikeMethodAt(0);
  }

  private parseNamedTypeReference(): NamedType {
    const type = this.parsePrimaryType();
    if (type.kind !== "named-type") {
      throw this.error("Expected interface name in implements clause");
    }
    return type;
  }

  /** Check if tokens starting at `offset` from current position look like a method. */
  private looksLikeMethodAt(offset: number): boolean {
    const t0 = this.peek(offset).type;
    const t1 = this.peek(offset + 1).type;
    // identifier ( ...
    if (t0 === TokenType.Identifier && t1 === TokenType.LeftParen) {
      return true;
    }
    // identifier < ... > ( ... — generic method
    if (t0 === TokenType.Identifier && t1 === TokenType.Less) {
      return this.looksLikeTypeParamsAt(offset + 1);
    }
    // identifier "description" ( ...
    if (t0 === TokenType.Identifier && t1 === TokenType.StringLiteral && this.peek(offset + 2).type === TokenType.LeftParen) {
      return true;
    }
    // static identifier ( ...
    if (t0 === TokenType.Static && t1 === TokenType.Identifier && this.peek(offset + 2).type === TokenType.LeftParen) {
      return true;
    }
    // static identifier < ... > ( ... — generic static method
    if (t0 === TokenType.Static && t1 === TokenType.Identifier && this.peek(offset + 2).type === TokenType.Less) {
      return this.looksLikeTypeParamsAt(offset + 2);
    }
    // static identifier "description" ( ...
    if (t0 === TokenType.Static && t1 === TokenType.Identifier && this.peek(offset + 2).type === TokenType.StringLiteral && this.peek(offset + 3).type === TokenType.LeftParen) {
      return true;
    }
    return false;
  }

  /** Check if tokens at `offset` look like `<T, U, ...>(` — type params followed by left paren. */
  private looksLikeTypeParamsAt(offset: number): boolean {
    if (this.peek(offset).type !== TokenType.Less) return false;
    let index = offset + 1;
    while (true) {
      if (this.peek(index).type !== TokenType.Identifier) return false;
      index++;
      if (this.peek(index).type === TokenType.Colon) {
        index = this.skipTypeAnnotationTokens(index + 1);
        if (index === -1) return false;
      }
      const separator = this.peek(index).type;
      if (separator === TokenType.Comma) {
        index++;
        continue;
      }
      if (separator !== TokenType.Greater) return false;
      const next = this.peek(index + 1);
      return next.type === TokenType.LeftParen
        || (next.type === TokenType.StringLiteral && this.peek(index + 2).type === TokenType.LeftParen);
    }
  }

  private parseShortMethodDeclaration(static__?: boolean, isolated_: boolean = false, private__: boolean = false, mock_: boolean = false): FunctionDeclaration {
    const startLoc = this.loc();
    let static_ = static__ ?? false;
    if (!static_ && this.match(TokenType.Static)) {
      static_ = true;
    }

    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();
    this.expect(TokenType.LeftParen);
    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);

    let returnType: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      returnType = this.parseTypeAnnotation();
    }

    let body: Expression | Block;
    let bodyless = false;
    if (this.match(TokenType.Arrow)) {
      body = this.parseExpression();
      this.consumeOptionalSemicolon();
    } else if (mock_ && !this.check(TokenType.LeftBrace)) {
      body = {
        kind: "block",
        statements: [],
        span: this.span(startLoc),
      };
      bodyless = true;
      this.consumeOptionalSemicolon();
    } else {
      body = this.parseBlock();
    }

    return {
      kind: "function-declaration",
      name,
      description,
      typeParams,
      typeParamConstraints,
      params,
      returnType,
      body,
      mock_,
      bodyless,
      exported: false,
      static_,
      isolated_,
      private_: private__,
      span: this.span(startLoc),
    };
  }

  private parseClassField(private__: boolean = false): ClassField {
    const startLoc = this.loc();
    let static_ = false;
    let readonly_ = false;
    let const_ = false;
    let weak_ = false;

    if (this.check(TokenType.Static)) {
      static_ = true;
      this.advance();
    }

    if (this.check(TokenType.Readonly)) {
      readonly_ = true;
      this.advance();
    } else if (this.check(TokenType.Const)) {
      const_ = true;
      this.advance();
    }

    if (this.check(TokenType.Weak)) {
      weak_ = true;
      this.advance();
    }

    // Support multi-name fields: x, y, z: float;
    // Each name may have an optional description: x "x-axis", y "y-axis": float
    const names: string[] = [this.expect(TokenType.Identifier).value];
    const descriptions: (string | undefined)[] = [this.parseDescription()];
    while (this.check(TokenType.Comma) && this.peek(1).type === TokenType.Identifier) {
      this.advance(); // comma
      names.push(this.expect(TokenType.Identifier).value);
      descriptions.push(this.parseDescription());
    }

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    let defaultValue: Expression | null = null;
    if (this.match(TokenType.Equal)) {
      defaultValue = this.parseExpression();
    }

    this.consumeOptionalSemicolon();

    return {
      kind: "class-field",
      names,
      descriptions,
      type,
      defaultValue,
      static_,
      readonly_,
      const_,
      weak_,
      private_: private__,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Interfaces
  // ===========================================================================

  private parseInterfaceDeclaration(exported: boolean): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Interface);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();

    this.expect(TokenType.LeftBrace);

    const fields: InterfaceField[] = [];
    const methods: InterfaceMethod[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      // Disallow 'private' on interface members
      if (this.check(TokenType.Private)) {
        throw this.error(`"private" is not allowed on interface members`);
      }
      if (this.check(TokenType.Static)) {
        this.advance();
        if (this.check(TokenType.Identifier) && (this.peek(1).type === TokenType.LeftParen || (this.peek(1).type === TokenType.StringLiteral && this.peek(2).type === TokenType.LeftParen) || this.peek(1).type === TokenType.Less)) {
          methods.push(this.parseInterfaceMethod(true));
          continue;
        }
        throw this.error('static fields are not yet supported on interface members');
      }
      // Method: name(params): ReturnType  or  name "desc"(params): ReturnType  or  name<T>(params): ReturnType
      if (this.check(TokenType.Identifier) && (this.peek(1).type === TokenType.LeftParen || (this.peek(1).type === TokenType.StringLiteral && this.peek(2).type === TokenType.LeftParen) || this.peek(1).type === TokenType.Less)) {
        methods.push(this.parseInterfaceMethod(false));
      } else {
        fields.push(this.parseInterfaceField());
      }
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "interface-declaration",
      name,
      description,
      typeParams,
      typeParamConstraints,
      fields,
      methods,
      exported,
      span: this.span(startLoc),
    };
  }

  private parseInterfaceField(): InterfaceField {
    const startLoc = this.loc();
    let readonly_ = false;
    if (this.match(TokenType.Readonly)) {
      readonly_ = true;
    }
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    this.expect(TokenType.Colon);
    const type = this.parseTypeAnnotation();
    this.consumeOptionalSemicolon();

    return {
      kind: "interface-field",
      name,
      description,
      type,
      static_: false,
      readonly_,
      span: this.span(startLoc),
    };
  }

  private parseInterfaceMethod(static_: boolean): InterfaceMethod {
    const startLoc = this.loc();
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();
    this.expect(TokenType.LeftParen);
    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);
    this.expect(TokenType.Colon);
    const returnType = this.parseTypeAnnotation();
    this.consumeOptionalSemicolon();

    return {
      kind: "interface-method",
      name,
      description,
      typeParams,
      typeParamConstraints,
      params,
      returnType,
      static_,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Enums
  // ===========================================================================

  private parseEnumDeclaration(exported: boolean): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Enum);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();

    this.expect(TokenType.LeftBrace);

    const variants: EnumVariant[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const vStart = this.loc();
      const vName = this.expect(TokenType.Identifier).value;
      const vDescription = this.parseDescription();

      let value: Expression | null = null;
      if (this.match(TokenType.Equal)) {
        value = this.parseExpression();
      }

      variants.push({
        kind: "enum-variant",
        name: vName,
        description: vDescription,
        value,
        span: this.span(vStart),
      });

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "enum-declaration",
      name,
      description,
      variants,
      exported,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Type Alias
  // ===========================================================================

  private parseTypeAlias(exported: boolean): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Type);
    const name = this.expect(TokenType.Identifier).value;
    const description = this.parseDescription();

    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();

    this.expect(TokenType.Equal);
    const type = this.parseTypeAnnotation();
    this.consumeOptionalSemicolon();

    return {
      kind: "type-alias-declaration",
      name,
      description,
      typeParams,
      typeParamConstraints,
      type,
      exported,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Imports & Exports
  // ===========================================================================

  private parseMockImportDirective(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Import);
    this.expect(TokenType.For);
    const sourcePattern = this.expect(TokenType.StringLiteral).value;
    this.expect(TokenType.LeftBrace);

    const mappings = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const mappingStart = this.loc();
      const dependency = this.expect(TokenType.StringLiteral).value;
      this.expect(TokenType.Arrow, 'Expected => in mock import mapping');
      const replacement = this.expect(TokenType.StringLiteral).value;
      mappings.push({
        dependency,
        replacement,
        span: this.span(mappingStart),
      });
      this.match(TokenType.Comma, TokenType.Semicolon);
    }

    this.expect(TokenType.RightBrace);
    this.consumeOptionalSemicolon();

    return {
      kind: "mock-import-directive",
      sourcePattern,
      mappings,
      span: this.span(startLoc),
    };
  }

  private parseImport(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Import);

    // import class — extern C++ class declaration
    if (this.check(TokenType.Class)) {
      return this.parseExternClassDeclaration(startLoc);
    }

    // import function — extern C/C++ function declaration
    if (this.check(TokenType.Function)) {
      return this.parseExternFunctionDeclaration(startLoc, false);
    }

    let typeOnly = false;
    if (this.check(TokenType.Type) && this.peek(1).type === TokenType.LeftBrace) {
      typeOnly = true;
      this.advance();
    }

    const specifiers: ImportSpecifier[] = [];

    if (this.match(TokenType.Star)) {
      this.expect(TokenType.As);
      const alias = this.expect(TokenType.Identifier).value;
      specifiers.push({
        kind: "namespace-import-specifier",
        alias,
        span: this.span(startLoc),
      });
    } else {
      this.expect(TokenType.LeftBrace);
      while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
        const specStart = this.loc();
        const name = this.expect(TokenType.Identifier).value;
        let alias: string | null = null;
        if (this.match(TokenType.As)) {
          alias = this.expect(TokenType.Identifier).value;
        }
        specifiers.push({
          kind: "named-import-specifier",
          name,
          alias,
          span: this.span(specStart),
        });
        if (!this.match(TokenType.Comma)) break;
      }
      this.expect(TokenType.RightBrace);
    }

    this.expect(TokenType.From);
    const source = this.expect(TokenType.StringLiteral).value;
    this.consumeOptionalSemicolon();

    return {
      kind: "import-declaration",
      specifiers,
      source,
      typeOnly,
      span: this.span(startLoc),
    };
  }

  /**
   * Parse `import class Name { ... }` or `import class Name from "header" { ... }`
   * or `import class Name from "header" as cpp::Name { ... }`.
   *
   * The `import` token has already been consumed; startLoc points to it.
   */
  private parseExternClassDeclaration(startLoc: SourceLocation, exported: boolean = false): Statement {
    this.expect(TokenType.Class);
    const name = this.expect(TokenType.Identifier).value;

    // Optional: from "header-path"
    let headerPath: string | null = null;
    if (this.match(TokenType.From)) {
      headerPath = this.expect(TokenType.StringLiteral).value;
    }

    // Optional: as fully::qualified::CppName
    let cppName: string | null = null;
    if (this.match(TokenType.As)) {
      cppName = this.parseCppQualifiedName();
    }

    // Body: { fields and methods }
    this.expect(TokenType.LeftBrace);

    const fields: ExternClassField[] = [];
    const methods: ExternClassMethod[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      // Method: name(params): RetType or static name(params): RetType
      if (
        (this.check(TokenType.Identifier) && this.peek(1).type === TokenType.LeftParen) ||
        (this.check(TokenType.Static) && this.peek(1).type === TokenType.Identifier && this.peek(2).type === TokenType.LeftParen)
      ) {
        methods.push(this.parseExternClassMethod());
      } else {
        fields.push(this.parseExternClassField());
      }
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "extern-class-declaration",
      name,
      exported,
      headerPath,
      cppName,
      fields,
      methods,
      span: this.span(startLoc),
    };
  }

  private parseExternClassField(): ExternClassField {
    const startLoc = this.loc();
    // Parse comma-separated field names: x, y, z: Type
    const names: string[] = [];
    const descriptions: (string | undefined)[] = [];
    names.push(this.expect(TokenType.Identifier).value);
    descriptions.push(this.parseDescription());
    while (this.match(TokenType.Comma)) {
      names.push(this.expect(TokenType.Identifier).value);
      descriptions.push(this.parseDescription());
    }
    this.expect(TokenType.Colon);
    const type = this.parseTypeAnnotation();
    this.consumeOptionalSemicolon();

    return {
      kind: "extern-class-field",
      names,
      descriptions,
      type,
      span: this.span(startLoc),
    };
  }

  private parseExternClassMethod(): ExternClassMethod {
    const startLoc = this.loc();
    const static_ = this.match(TokenType.Static);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LeftParen);
    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);
    this.expect(TokenType.Colon);
    const returnType = this.parseTypeAnnotation();
    this.consumeOptionalSemicolon();

    return {
      kind: "extern-class-method",
      name,
      static_,
      params,
      returnType,
      span: this.span(startLoc),
    };
  }

  /**
   * Parse `import function name(params): Type from "header" [as cpp::name]`.
   *
   * The `import` token has already been consumed; startLoc points to it.
   */
  private parseExternFunctionDeclaration(
    startLoc: SourceLocation,
    exported: boolean,
  ): ExternFunctionDeclaration {
    this.expect(TokenType.Function);
    const name = this.expect(TokenType.Identifier).value;
    const { names: typeParams, constraints: typeParamConstraints } = this.parseTypeParams();

    this.expect(TokenType.LeftParen);
    const params = this.parseParameterList();
    this.expect(TokenType.RightParen);
    this.expect(TokenType.Colon);
    const returnType = this.parseTypeAnnotation();

    // Optional: from "header-path"
    let headerPath: string | null = null;
    if (this.match(TokenType.From)) {
      headerPath = this.expect(TokenType.StringLiteral).value;
    }

    // Optional: as fully::qualified::cppName
    let cppName: string | null = null;
    if (this.match(TokenType.As)) {
      cppName = this.parseCppQualifiedName();
    }

    this.consumeOptionalSemicolon();

    return {
      kind: "extern-function-declaration",
      name,
      typeParams,
      typeParamConstraints,
      headerPath,
      cppName,
      params,
      returnType,
      exported,
      span: this.span(startLoc),
    };
  }

  private parseExport(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Export);

    // export * from "mod"  or  export * as ns from "mod"
    if (this.check(TokenType.Star)) {
      this.advance();
      let alias: string | null = null;
      if (this.match(TokenType.As)) {
        alias = this.expect(TokenType.Identifier).value;
      }
      this.expect(TokenType.From);
      const source = this.expect(TokenType.StringLiteral).value;
      this.consumeOptionalSemicolon();
      return {
        kind: "export-all-declaration",
        source,
        alias,
        span: this.span(startLoc),
      };
    }

    // export { ... } or export { ... } from "mod"
    if (this.check(TokenType.LeftBrace)) {
      this.advance();
      const specifiers: ExportSpecifier[] = [];
      while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
        const specStart = this.loc();
        const name = this.expect(TokenType.Identifier).value;
        let alias: string | null = null;
        if (this.match(TokenType.As)) {
          alias = this.expect(TokenType.Identifier).value;
        }
        specifiers.push({
          kind: "export-specifier",
          name,
          alias,
          span: this.span(specStart),
        });
        if (!this.match(TokenType.Comma)) break;
      }
      this.expect(TokenType.RightBrace);

      let source: string | null = null;
      if (this.match(TokenType.From)) {
        source = this.expect(TokenType.StringLiteral).value;
      }
      this.consumeOptionalSemicolon();
      return {
        kind: "export-list",
        specifiers,
        source,
        span: this.span(startLoc),
      };
    }

    // export const / readonly / function / class / interface / enum / type
    let declaration: Statement;
    switch (this.current().type) {
      case TokenType.Private:
        throw this.error(`Cannot export a private declaration`);
      case TokenType.Mock:
        this.advance();
        if (this.check(TokenType.Function)) {
          declaration = this.parseFunctionDeclaration(true, false, false, false, true);
          break;
        }
        if (this.check(TokenType.Class)) {
          declaration = this.parseClassDeclaration(true, false, true);
          break;
        }
        if (this.check(TokenType.Import)) {
          throw this.error("Cannot export a mock import directive");
        }
        throw this.error(`Unexpected token after export mock: ${this.current().type}`);
      case TokenType.Const:
        declaration = this.parseConstDeclaration(true);
        break;
      case TokenType.Readonly:
        declaration = this.parseReadonlyDeclaration(true);
        break;
      case TokenType.Function:
        declaration = this.parseFunctionDeclaration(true, false);
        break;
      case TokenType.Isolated:
        if (this.peek(1).type === TokenType.Function) {
          this.advance(); // consume 'isolated'
          declaration = this.parseFunctionDeclaration(true, false, true);
        } else {
          throw this.error(`Unexpected token after export isolated: ${this.peek(1).type}`);
        }
        break;
      case TokenType.Class:
        declaration = this.parseClassDeclaration(true);
        break;
      case TokenType.Interface:
        declaration = this.parseInterfaceDeclaration(true);
        break;
      case TokenType.Enum:
        declaration = this.parseEnumDeclaration(true);
        break;
      case TokenType.Type:
        declaration = this.parseTypeAlias(true);
        break;
      case TokenType.Import:
        if (this.peek(1).type === TokenType.Function) {
          const importLoc = this.loc();
          this.advance(); // consume 'import'
          declaration = this.parseExternFunctionDeclaration(importLoc, true);
          break;
        }
        if (this.peek(1).type === TokenType.Class) {
          const importLoc = this.loc();
          this.advance(); // consume 'import'
          declaration = this.parseExternClassDeclaration(importLoc, true);
          break;
        }
        throw this.error(`Unexpected token after export import: ${this.peek(1).type}`);
      default:
        throw this.error(`Unexpected token after export: ${this.current().type}`);
    }

    return {
      kind: "export-declaration",
      declaration,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Control Flow
  // ===========================================================================

  private parseReturnStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Return);

    let value: Expression | null = null;
    if (
      !this.check(TokenType.Semicolon) &&
      !this.check(TokenType.RightBrace) &&
      !this.isAtEnd()
    ) {
      value = this.parseExpression();
    }
    this.consumeOptionalSemicolon();

    return {
      kind: "return-statement",
      value,
      span: this.span(startLoc),
    };
  }

  private parseYieldStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Yield);

    if (
      this.check(TokenType.Semicolon) ||
      this.check(TokenType.RightBrace) ||
      this.isAtEnd()
    ) {
      throw this.error("'yield' requires a value");
    }

    const value = this.parseExpression();
    this.consumeOptionalSemicolon();

    return {
      kind: "yield-statement",
      value,
      span: this.span(startLoc),
    };
  }

  private parseIfStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.If);
    const condition = this.parseExpression();
    const body = this.parseBlock();

    const elseIfs: { condition: Expression; body: Block; span: SourceSpan }[] = [];
    let else_: Block | null = null;

    while (this.match(TokenType.Else)) {
      if (this.check(TokenType.If)) {
        const eifStart = this.loc();
        this.advance(); // if
        const eifCond = this.parseExpression();
        const eifBody = this.parseBlock();
        elseIfs.push({
          condition: eifCond,
          body: eifBody,
          span: this.span(eifStart),
        });
      } else {
        else_ = this.parseBlock();
        break;
      }
    }

    return {
      kind: "if-statement",
      condition,
      body,
      elseIfs,
      else_,
      span: this.span(startLoc),
    };
  }

  private parseWhileStatement(label: string | null): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.While);
    const condition = this.parseExpression();
    const body = this.parseBlock();

    return {
      kind: "while-statement",
      condition,
      body,
      label,
      then_: this.parseLoopThenClause("while"),
      span: this.span(startLoc),
    };
  }

  private parseForStatement(label: string | null): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.For);

    // Check for for-of: `for <bindings> of <expr>`
    if (this.looksLikeForOf()) {
      return this.parseForOfStatement(label, startLoc);
    }

    // Traditional for: `for let i = 0; condition; update { body }`
    // Both semicolons are required separators (not optional terminators).
    let init: Statement | null = null;
    if (this.check(TokenType.Let)) {
      init = this.parseForLetInit();
    } else if (!this.check(TokenType.Semicolon)) {
      init = this.parseForExprInit();
    }
    this.expect(TokenType.Semicolon);

    let condition: Expression | null = null;
    if (!this.check(TokenType.Semicolon)) {
      condition = this.parseExpression();
    }
    this.expect(TokenType.Semicolon);

    const update: Expression[] = [];
    while (!this.check(TokenType.LeftBrace) && !this.isAtEnd()) {
      update.push(this.parseForUpdateExpression());
      if (!this.match(TokenType.Comma)) break;
    }

    const body = this.parseBlock();

    return {
      kind: "for-statement",
      init,
      condition,
      update,
      body,
      label,
      then_: this.parseLoopThenClause("for"),
      span: this.span(startLoc),
    };
  }

  /**
   * Parse the init clause of a traditional for-loop starting with `let`.
   * Does NOT consume a trailing semicolon — the for-loop expects it explicitly.
   */
  private parseForLetInit(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Let);
    const name = this.expect(TokenType.Identifier).value;

    let type: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      type = this.parseTypeAnnotation();
    }

    this.expect(TokenType.Equal);
    const value = this.parseExpression();

    return {
      kind: "let-declaration",
      name,
      type,
      value,
      span: this.span(startLoc),
    };
  }

  /**
   * Parse the init clause of a traditional for-loop that is an expression or binding.
   * Does NOT consume a trailing semicolon — the for-loop expects it explicitly.
   */
  private parseForExprInit(): Statement {
    const startLoc = this.loc();
    const expr = this.parseExpression();

    // Check for := (immutable binding)
    if (this.check(TokenType.ColonEqual)) {
      this.advance();
      if (expr.kind !== "identifier") {
        throw this.error("Left side of := must be an identifier");
      }
      const value = this.parseExpression();
      return {
        kind: "immutable-binding",
        name: expr.name,
        type: null,
        value,
        span: this.span(startLoc),
      };
    }

    // Check for assignment operators
    const assignOp = this.tryParseAssignmentOperator();
    if (assignOp) {
      const value = this.parseExpression();
      return {
        kind: "expression-statement",
        expression: {
          kind: "assignment-expression",
          operator: assignOp,
          target: expr,
          value,
          span: this.span(startLoc),
        },
        span: this.span(startLoc),
      };
    }

    return {
      kind: "expression-statement",
      expression: expr,
      span: this.span(startLoc),
    };
  }

  /**
   * Parse a for-loop update expression. Handles both plain expressions
   * and assignment operators (e.g., `i += 1`).
   */
  private parseForUpdateExpression(): Expression {
    const startLoc = this.loc();
    const expr = this.parseExpression();

    const assignOp = this.tryParseAssignmentOperator();
    if (assignOp) {
      const value = this.parseExpression();
      return {
        kind: "assignment-expression",
        operator: assignOp,
        target: expr,
        value,
        span: this.span(startLoc),
      };
    }

    return expr;
  }

  private looksLikeForOf(): boolean {
    // for <identifier(s)> of
    // for <identifier> , <identifier> of
    let i = 0;
    while (this.peek(i).type === TokenType.Identifier) {
      i++;
      if (this.peek(i).type === TokenType.Of) return true;
      if (this.peek(i).type === TokenType.Comma) {
        i++;
      } else {
        break;
      }
    }
    return false;
  }

  private parseForOfStatement(label: string | null, startLoc: SourceLocation): Statement {
    const bindings: string[] = [];
    bindings.push(this.expect(TokenType.Identifier).value);
    while (this.match(TokenType.Comma)) {
      bindings.push(this.expect(TokenType.Identifier).value);
    }
    this.expect(TokenType.Of);
    const iterable = this.parseExpression();
    const body = this.parseBlock();

    return {
      kind: "for-of-statement",
      bindings,
      iterable,
      body,
      label,
      then_: this.parseLoopThenClause("for"),
      span: this.span(startLoc),
    };
  }

  private parseLoopThenClause(loopKind: "for" | "while"): Block | null {
    if (this.match(TokenType.Then)) {
      return this.parseBlock();
    }
    if (this.check(TokenType.Else)) {
      throw this.error(`${loopKind} loop follow-up clause uses 'then', not 'else'`);
    }
    return null;
  }

  private parseWithStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.With);

    const bindings: {
      name: string;
      type: TypeAnnotation | null;
      value: Expression;
      span: SourceSpan;
    }[] = [];

    // Parse comma-separated bindings: name [:Type] := expr
    do {
      const bindingStart = this.loc();
      const name = this.expect(TokenType.Identifier).value;

      // Optional type annotation
      let type: TypeAnnotation | null = null;
      if (this.check(TokenType.Colon)) {
        this.advance();
        type = this.parseTypeAnnotation();
      }

      this.expect(TokenType.ColonEqual);
      const value = this.parseExpression();

      bindings.push({ name, type, value, span: this.span(bindingStart) });
    } while (this.match(TokenType.Comma));

    const body = this.parseBlock();

    return {
      kind: "with-statement",
      bindings,
      body,
      span: this.span(startLoc),
    };
  }

  private parseBreakStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Break);
    let label: string | null = null;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.consumeOptionalSemicolon();
    return {
      kind: "break-statement",
      label,
      span: this.span(startLoc),
    };
  }

  private parseContinueStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Continue);
    let label: string | null = null;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.consumeOptionalSemicolon();
    return {
      kind: "continue-statement",
      label,
      span: this.span(startLoc),
    };
  }

  /**
   * Parse `try <binding>` statement.
   * Supported binding forms:
   *   try x := expr
   *   try x: Type := expr
   *   try const x = expr
   *   try readonly x = expr
   *   try let x = expr
   *   try (a, b) := expr
   *   try {a, b} := expr
   *   try x = expr  (assignment)
   */
  private parseTryStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Try);

    let binding: import("./ast.js").TryBinding;

    if (this.check(TokenType.Const)) {
      binding = this.parseConstDeclaration(false) as import("./ast.js").ConstDeclaration;
    } else if (this.check(TokenType.Readonly)) {
      binding = this.parseReadonlyDeclaration(false) as import("./ast.js").ReadonlyDeclaration;
    } else if (this.check(TokenType.Let)) {
      binding = this.parseLetDeclaration() as import("./ast.js").TryBinding;
    } else if (this.check(TokenType.LeftBracket) && this.looksLikeArrayDestructuring(TokenType.ColonEqual)) {
      binding = this.parseArrayDestructuring("immutable") as import("./ast.js").ArrayDestructuring;
    } else if (this.check(TokenType.LeftParen) && this.looksLikePositionalDestructuring(TokenType.ColonEqual)) {
      binding = this.parsePositionalDestructuring("immutable") as import("./ast.js").PositionalDestructuring;
    } else if (this.check(TokenType.LeftBrace) && this.looksLikeNamedDestructuring(TokenType.ColonEqual)) {
      binding = this.parseNamedDestructuring("immutable") as import("./ast.js").NamedDestructuring;
    } else if (this.check(TokenType.LeftBracket) && this.looksLikeArrayDestructuring(TokenType.Equal)) {
      binding = this.parseArrayDestructuringAssignment() as import("./ast.js").ArrayDestructuringAssignment;
    } else if (this.check(TokenType.LeftParen) && this.looksLikePositionalDestructuring(TokenType.Equal)) {
      binding = this.parsePositionalDestructuringAssignment() as import("./ast.js").PositionalDestructuringAssignment;
    } else if (this.check(TokenType.LeftBrace) && this.looksLikeNamedDestructuring(TokenType.Equal)) {
      binding = this.parseNamedDestructuringAssignment() as import("./ast.js").NamedDestructuringAssignment;
    } else {
      // Handles: `try x := expr`, `try x: Type := expr`, `try x = expr`
      binding = this.parseExpressionOrBinding() as import("./ast.js").TryBinding;
    }

    return {
      kind: "try-statement",
      binding,
      span: this.span(startLoc),
    };
  }

  private parseLabeledStatement(): Statement {
    const label = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Colon);

    if (this.check(TokenType.For)) {
      return this.parseForStatement(label);
    }
    if (this.check(TokenType.While)) {
      return this.parseWhileStatement(label);
    }
    throw this.error("Label must be followed by 'for' or 'while'");
  }

  // ===========================================================================
  // Block
  // ===========================================================================

  private parseBlock(): Block {
    const startLoc = this.loc();
    this.expect(TokenType.LeftBrace);

    const statements: Statement[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      statements.push(this.parseStatement());
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "block",
      statements,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Destructuring
  // ===========================================================================

  private looksLikePositionalDestructuring(expectedOperator?: TokenType): boolean {
    // (a, b, ...) := or (a, b, ...) = (for let contexts)
    let i = 1;
    while (true) {
      if (this.peek(i).type === TokenType.Identifier || this.peek(i).type === TokenType.Underscore) {
        i++;
      } else {
        break;
      }
      if (this.peek(i).type === TokenType.Comma) {
        i++;
      } else if (this.peek(i).type === TokenType.RightParen) {
        i++;
        return this.matchesDestructuringOperator(this.peek(i).type, expectedOperator);
      } else {
        break;
      }
    }
    return false;
  }

  private looksLikeArrayDestructuring(expectedOperator?: TokenType): boolean {
    let i = 1;
    while (true) {
      if (this.peek(i).type === TokenType.Identifier || this.peek(i).type === TokenType.Underscore) {
        i++;
      } else {
        break;
      }
      if (this.peek(i).type === TokenType.Comma) {
        i++;
      } else if (this.peek(i).type === TokenType.RightBracket) {
        i++;
        return this.matchesDestructuringOperator(this.peek(i).type, expectedOperator);
      } else {
        break;
      }
    }
    return false;
  }

  private looksLikeNamedDestructuring(expectedOperator?: TokenType): boolean {
    // { a, b, ... } := or after `let`
    let i = 1;
    while (true) {
      if (this.peek(i).type === TokenType.Identifier) {
        i++;
      } else {
        break;
      }
      // optional `as alias`
      if (this.peek(i).type === TokenType.As) {
        i++;
        if (this.peek(i).type === TokenType.Identifier) {
          i++;
        }
      }
      if (this.peek(i).type === TokenType.Comma) {
        i++;
      } else if (this.peek(i).type === TokenType.RightBrace) {
        i++;
        return this.matchesDestructuringOperator(this.peek(i).type, expectedOperator);
      } else {
        break;
      }
    }
    return false;
  }

  private matchesDestructuringOperator(operator: TokenType, expectedOperator?: TokenType): boolean {
    if (expectedOperator) return operator === expectedOperator;
    return operator === TokenType.ColonEqual || operator === TokenType.Equal;
  }

  private parsePositionalBindingPattern(): string[] {
    this.expect(TokenType.LeftParen);
    const bindings: string[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      if (this.check(TokenType.Identifier)) {
        bindings.push(this.advance().value);
      } else if (this.check(TokenType.Underscore)) {
        this.advance();
        bindings.push("_");
      } else {
        throw this.error("Expected identifier or '_' in positional destructuring");
      }
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightParen);
    return bindings;
  }

  private parseArrayBindingPattern(): string[] {
    this.expect(TokenType.LeftBracket);
    const bindings: string[] = [];
    while (!this.check(TokenType.RightBracket) && !this.isAtEnd()) {
      if (this.check(TokenType.Identifier)) {
        bindings.push(this.advance().value);
      } else if (this.check(TokenType.Underscore)) {
        this.advance();
        bindings.push("_");
      } else {
        throw this.error("Expected identifier or '_' in array destructuring");
      }
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBracket);
    return bindings;
  }

  private parseNamedBindingPattern(): DestructureBinding[] {
    this.expect(TokenType.LeftBrace);
    const bindings: DestructureBinding[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const bStart = this.loc();
      const name = this.expect(TokenType.Identifier).value;
      let alias: string | null = null;
      if (this.match(TokenType.As)) {
        alias = this.expect(TokenType.Identifier).value;
      }
      bindings.push({ name, alias, span: this.span(bStart) });
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightBrace);
    return bindings;
  }

  private parsePositionalDestructuring(bindingKind: "immutable" | "let"): Statement {
    const startLoc = this.loc();
    const bindings = this.parsePositionalBindingPattern();

    if (bindingKind === "immutable") {
      this.expect(TokenType.ColonEqual);
    } else {
      this.expect(TokenType.Equal);
    }

    const value = this.parseExpression();
    this.consumeOptionalSemicolon();

    return {
      kind: "positional-destructuring",
      bindings,
      bindingKind,
      value,
      span: this.span(startLoc),
    };
  }

  private parseArrayDestructuring(bindingKind: "immutable" | "let"): Statement {
    const startLoc = this.loc();
    const bindings = this.parseArrayBindingPattern();

    if (bindingKind === "immutable") {
      this.expect(TokenType.ColonEqual);
    } else {
      this.expect(TokenType.Equal);
    }

    const value = this.parseExpression();
    this.consumeOptionalSemicolon();

    return {
      kind: "array-destructuring",
      bindings,
      bindingKind,
      value,
      span: this.span(startLoc),
    };
  }

  private parseNamedDestructuring(bindingKind: "immutable" | "let"): Statement {
    const startLoc = this.loc();
    const bindings = this.parseNamedBindingPattern();

    if (bindingKind === "immutable") {
      this.expect(TokenType.ColonEqual);
    } else {
      this.expect(TokenType.Equal);
    }

    const value = this.parseExpression();
    this.consumeOptionalSemicolon();

    return {
      kind: "named-destructuring",
      bindings,
      bindingKind,
      value,
      span: this.span(startLoc),
    };
  }

  private parsePositionalDestructuringAssignment(): Statement {
    const startLoc = this.loc();
    const bindings = this.parsePositionalBindingPattern();
    this.expect(TokenType.Equal);
    const value = this.parseExpression();
    this.consumeOptionalSemicolon();
    return {
      kind: "positional-destructuring-assignment",
      bindings,
      value,
      span: this.span(startLoc),
    };
  }

  private parseArrayDestructuringAssignment(): Statement {
    const startLoc = this.loc();
    const bindings = this.parseArrayBindingPattern();
    this.expect(TokenType.Equal);
    const value = this.parseExpression();
    this.consumeOptionalSemicolon();
    return {
      kind: "array-destructuring-assignment",
      bindings,
      value,
      span: this.span(startLoc),
    };
  }

  private parseNamedDestructuringAssignment(): Statement {
    const startLoc = this.loc();
    const bindings = this.parseNamedBindingPattern();
    this.expect(TokenType.Equal);
    const value = this.parseExpression();
    this.consumeOptionalSemicolon();
    return {
      kind: "named-destructuring-assignment",
      bindings,
      value,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Type Annotations
  // ===========================================================================

  private parseTypeAnnotation(): TypeAnnotation {
    let type = this.parsePrimaryType();

    // Check for union: T | U
    if (this.check(TokenType.Pipe)) {
      const types: TypeAnnotation[] = [type];
      while (this.match(TokenType.Pipe)) {
        types.push(this.parsePrimaryType());
      }
      type = {
        kind: "union-type",
        types,
        span: { start: types[0].span.start, end: types[types.length - 1].span.end },
      };
    }

    // Check for array suffix []
    while (this.check(TokenType.LeftBracket) && this.peek(1).type === TokenType.RightBracket) {
      const arrStart = type.span.start;
      this.advance(); // [
      this.advance(); // ]
      type = {
        kind: "array-type",
        elementType: type,
        readonly_: false,
        span: { start: arrStart, end: this.loc() },
      };
    }

    return type;
  }

  private parseCppQualifiedName(): string {
    const parts: string[] = [this.expect(TokenType.Identifier).value];
    while (this.match(TokenType.DoubleColon)) {
      parts.push(this.expect(TokenType.Identifier).value);
    }
    return parts.join("::");
  }

  private parsePrimaryType(): TypeAnnotation {
    const startLoc = this.loc();

    // readonly T[] or readonly keyword before type
    if (this.check(TokenType.Readonly)) {
      this.advance();
      const inner = this.parsePrimaryType();
      // Check for array suffix
      if (this.check(TokenType.LeftBracket) && this.peek(1).type === TokenType.RightBracket) {
        this.advance(); // [
        this.advance(); // ]
        return {
          kind: "array-type",
          elementType: inner,
          readonly_: true,
          span: this.span(startLoc),
        };
      }
      // If inner type is already an array (e.g., int[] consumed by inner parsePrimaryType)
      if (inner.kind === "array-type") {
        return { ...inner, readonly_: true };
      }
      if (inner.kind === "named-type") {
        if (inner.name === "Array" || inner.name === "ReadonlyArray") {
          return {
            ...inner,
            name: "ReadonlyArray",
            span: this.span(startLoc),
          };
        }
        if (inner.name === "Map" || inner.name === "ReadonlyMap") {
          return {
            ...inner,
            name: "ReadonlyMap",
            span: this.span(startLoc),
          };
        }
        if (inner.name === "Set" || inner.name === "ReadonlySet") {
          return {
            ...inner,
            name: "ReadonlySet",
            span: this.span(startLoc),
          };
        }
      }
      throw this.error("Unexpected readonly type modifier; expected an array, Array<T>, Map<K, V>, or Set<T> type");
    }

    // weak T
    if (this.check(TokenType.Weak)) {
      this.advance();
      const inner = this.parseTypeAnnotation();
      return {
        kind: "weak-type",
        type: inner,
        span: this.span(startLoc),
      };
    }

    // Function type: (param: Type, ...): ReturnType
    if (this.check(TokenType.LeftParen) && this.looksLikeFunctionType()) {
      return this.parseFunctionTypeAnnotation(startLoc);
    }

    // Tuple type: Tuple<T1, T2, ...>
    // Named type with generics: Identifier<T, U>
    if (this.check(TokenType.Identifier) || this.check(TokenType.Void)) {
      const name = this.advance().value;

      let typeArgs: TypeAnnotation[] = [];
      if (this.match(TokenType.Less)) {
        typeArgs.push(this.parseTypeAnnotation());
        while (this.match(TokenType.Comma)) {
          typeArgs.push(this.parseTypeAnnotation());
        }
        this.expect(TokenType.Greater);
      }

      let type: TypeAnnotation = {
        kind: "named-type",
        name,
        typeArgs,
        span: this.span(startLoc),
      };

      // Check for array suffix
      while (this.check(TokenType.LeftBracket) && this.peek(1).type === TokenType.RightBracket) {
        this.advance(); // [
        this.advance(); // ]
        type = {
          kind: "array-type",
          elementType: type,
          readonly_: false,
          span: this.span(startLoc),
        };
      }

      return type;
    }

    // Primitive keywords used as types
    const primKeywords = [
      TokenType.Null,
    ];
    if (primKeywords.includes(this.current().type)) {
      const name = this.advance().value;
      return {
        kind: "named-type",
        name,
        typeArgs: [],
        span: this.span(startLoc),
      };
    }

    throw this.error(`Expected type annotation, got ${this.current().type}`);
  }

  private looksLikeFunctionType(): boolean {
    // (param: Type, ...): ReturnType
    // We look for a pattern like (identifier: ...): 
    let depth = 1;
    let i = 1;
    while (depth > 0) {
      const t = this.peek(i);
      if (t.type === TokenType.EOF) return false;
      if (t.type === TokenType.LeftParen) depth++;
      if (t.type === TokenType.RightParen) depth--;
      i++;
    }
    // After ), check for :
    return this.peek(i).type === TokenType.Colon;
  }

  private parseFunctionTypeAnnotation(startLoc: SourceLocation): TypeAnnotation {
    this.expect(TokenType.LeftParen);

    const params: { name: string; type: TypeAnnotation; span: SourceSpan }[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      const pStart = this.loc();
      const name = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const type = this.parseTypeAnnotation();
      params.push({ name, type, span: this.span(pStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightParen);
    this.expect(TokenType.Colon);
    const returnType = this.parseTypeAnnotation();

    return {
      kind: "function-type",
      params,
      returnType,
      span: this.span(startLoc),
    };
  }

  // ===========================================================================
  // Expressions (Pratt parser / precedence climbing)
  // ===========================================================================

  private parseExpression(): Expression {
    return this.parseAssignmentExpression();
  }

  private parseAssignmentExpression(): Expression {
    return this.parseNullCoalescing();
  }

  private parseNullCoalescing(): Expression {
    let left = this.parseLogicalOr();

    while (this.check(TokenType.QuestionQuestion)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseLogicalOr(); // right-to-left: recurse to same level
      left = {
        kind: "binary-expression",
        operator: "??",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseLogicalOr(): Expression {
    let left = this.parseLogicalAnd();

    while (this.check(TokenType.PipePipe)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseLogicalAnd();
      left = {
        kind: "binary-expression",
        operator: "||",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseLogicalAnd(): Expression {
    let left = this.parseBitwiseOr();

    while (this.check(TokenType.AmpersandAmpersand)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseBitwiseOr();
      left = {
        kind: "binary-expression",
        operator: "&&",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseBitwiseOr(): Expression {
    let left = this.parseBitwiseXor();

    while (this.check(TokenType.Pipe)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseBitwiseXor();
      left = {
        kind: "binary-expression",
        operator: "|",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseBitwiseXor(): Expression {
    let left = this.parseBitwiseAnd();

    while (this.check(TokenType.Caret)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseBitwiseAnd();
      left = {
        kind: "binary-expression",
        operator: "^",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseBitwiseAnd(): Expression {
    let left = this.parseEquality();

    while (this.check(TokenType.Ampersand)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseEquality();
      left = {
        kind: "binary-expression",
        operator: "&",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseEquality(): Expression {
    let left = this.parseComparison();

    while (this.check(TokenType.EqualEqual) || this.check(TokenType.BangEqual)) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      const right = this.parseComparison();
      left = {
        kind: "binary-expression",
        operator: op,
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseShift();

    while (
      this.check(TokenType.Less) ||
      this.check(TokenType.LessEqual) ||
      this.check(TokenType.Greater) ||
      this.check(TokenType.GreaterEqual)
    ) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      const right = this.parseShift();
      left = {
        kind: "binary-expression",
        operator: op,
        left,
        right,
        span: this.span(startLoc),
      };
    }

    return left;
  }

  private parseShift(): Expression {
    let left = this.parseRange();

    while (
      this.check(TokenType.LessLess) ||
      this.check(TokenType.GreaterGreater) ||
      this.check(TokenType.GreaterGreaterGreater)
    ) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      const right = this.parseAdditive();
      left = {
        kind: "binary-expression",
        operator: op,
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseRange(): Expression {
    let left = this.parseAdditive();

    if (!this.shouldStopStatementCaseArmExpression() && (this.check(TokenType.DotDot) || this.check(TokenType.DotDotLess))) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      // Right side is optional for open-ended ranges
      if (
        !this.isAtEnd() &&
        !this.check(TokenType.RightParen) &&
        !this.check(TokenType.RightBrace) &&
        !this.check(TokenType.RightBracket) &&
        !this.check(TokenType.Comma) &&
        !this.check(TokenType.Arrow) &&
        !this.check(TokenType.Semicolon)
      ) {
        const right = this.parseAdditive();
        left = {
          kind: "binary-expression",
          operator: op,
          left,
          right,
          span: this.span(startLoc),
        };
      } else {
        // Open-ended range: left..
        left = {
          kind: "binary-expression",
          operator: op,
          left,
          right: { kind: "null-literal", span: this.span(startLoc) },
          span: this.span(startLoc),
        };
      }
    }

    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();

    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      const right = this.parseMultiplicative();
      left = {
        kind: "binary-expression",
        operator: op,
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseExponentiation();

    while (
      this.check(TokenType.Star) ||
      this.check(TokenType.Slash) ||
      this.check(TokenType.Backslash) ||
      this.check(TokenType.Percent)
    ) {
      const startLoc = left.span.start;
      const op = this.advance().value as BinaryOperator;
      const right = this.parseExponentiation();
      left = {
        kind: "binary-expression",
        operator: op,
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseExponentiation(): Expression {
    const left = this.parseUnary();

    if (this.check(TokenType.StarStar)) {
      const startLoc = left.span.start;
      this.advance();
      const right = this.parseExponentiation(); // right-to-left
      return {
        kind: "binary-expression",
        operator: "**",
        left,
        right,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseUnary(): Expression {
    const startLoc = this.loc();

    // Prefix unary: - + ! ~
    if (this.check(TokenType.Minus) || this.check(TokenType.Plus) ||
        this.check(TokenType.Bang) || this.check(TokenType.Tilde)) {
      const op = this.advance().value as UnaryOperator;
      const operand = this.parseUnary();
      return {
        kind: "unary-expression",
        operator: op,
        operand,
        prefix: true,
        span: this.span(startLoc),
      };
    }

    // try!, try?
    if (this.check(TokenType.Identifier) && (this.current().value === "try!" || this.current().value === "try?")) {
      const op = this.advance().value as UnaryOperator;
      const operand = this.parseUnary();
      return {
        kind: "unary-expression",
        operator: op,
        operand,
        prefix: true,
        span: this.span(startLoc),
      };
    }

    // async expression: async call(), async actor.method(), async { block }
    if (this.check(TokenType.Async)) {
      return this.parseAsyncExpression(startLoc);
    }

    return this.parseAs();
  }

  private parseAs(): Expression {
    let left = this.parsePostfix();

    while (this.check(TokenType.As) && this.isCurrentTokenOnSameLineAsPrevious()) {
      const startLoc = left.span.start;
      this.advance(); // consume 'as'
      const targetType = this.parseTypeAnnotation();
      left = {
        kind: "as-expression",
        expression: left,
        targetType,
        span: this.span(startLoc),
      };
    }
    return left;
  }

  private parseAsyncExpression(startLoc: SourceLocation): AsyncExpression {
    this.advance(); // consume 'async'

    // async { block } — anonymous async block
    if (this.check(TokenType.LeftBrace)) {
      const block = this.parseBlock();
      return {
        kind: "async-expression",
        expression: block,
        span: this.span(startLoc),
      };
    }

    // async expr — must be a call expression or method call
    const expr = this.parsePostfix();
    return {
      kind: "async-expression",
      expression: expr as Expression,
      span: this.span(startLoc),
    };
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.shouldStopStatementCaseArmExpression()) {
        return expr;
      }
      if (this.check(TokenType.Dot)) {
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = {
          kind: "member-expression",
          object: expr,
          property,
          optional: false,
          force: false,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.DoubleColon)) {
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = {
          kind: "qualified-member-expression",
          object: expr,
          property,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.QuestionDot)) {
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = {
          kind: "member-expression",
          object: expr,
          property,
          optional: true,
          force: false,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.BangDot)) {
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = {
          kind: "member-expression",
          object: expr,
          property,
          optional: false,
          force: true,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.Bang)
                 && this.isCurrentTokenOnSameLineAsPrevious()) {
        // Postfix non-null assertion: expr!
        // Only when `!` is on the same line as the preceding token.
        this.advance();
        expr = {
          kind: "non-null-assertion",
          expression: expr,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.LeftBracket) && this.isCurrentTokenOnSameLineAsPrevious()) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RightBracket);
        expr = {
          kind: "index-expression",
          object: expr,
          index,
          optional: false,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.QuestionBracket) && this.isCurrentTokenOnSameLineAsPrevious()) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RightBracket);
        expr = {
          kind: "index-expression",
          object: expr,
          index,
          optional: true,
          span: { start: expr.span.start, end: this.loc() },
        };
      } else if (this.check(TokenType.LeftParen) && this.isCurrentTokenOnSameLineAsPrevious()) {
        expr = this.parseCallExpression(expr);
        // Trailing lambda: `call() { body }` — attach block as trailing lambda arg.
        // Requires:
        // 1. allowTrailingLambda context (expression-statements and bindings only)
        // 2. `{` is on the SAME LINE as the closing `)` to avoid ambiguity
        //    with destructuring or other `{`-starting constructs on the next line.
        if (this.allowTrailingLambda
            && this.check(TokenType.LeftBrace)
            && expr.kind === "call-expression"
            && this.isCurrentTokenOnSameLineAsPrevious()) {
          const blockStart = this.loc();
          const block = this.parseBlock();
          const lambda: LambdaExpression = {
            kind: "lambda-expression",
            params: [],
            returnType: null,
            body: block,
            parameterless: true,
            trailing: true,
            span: this.span(blockStart),
          };
          (expr as CallExpression).args.push({
            value: lambda,
            span: this.span(blockStart),
          });
          // Update the call span to include the trailing block
          expr.span = { start: expr.span.start, end: this.loc() };
          // No chaining after trailing lambda — break out of postfix loop
          break;
        }
      } else if (this.check(TokenType.LeftBrace)
          && this.isCurrentTokenImmediatelyAfterPrevious()) {
        expr = this.parseNamedCallExpression(expr);
      } else {
        break;
      }
    }

    return expr;
  }

  private parseCallExpression(callee: Expression): Expression {
    this.expect(TokenType.LeftParen);
    const args: CallArgument[] = [];

    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      const argStart = this.loc();
      const arg = this.parseExpression();
      args.push({
        value: arg,
        span: this.span(argStart),
      });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightParen);

    return {
      kind: "call-expression",
      callee,
      args,
      span: { start: callee.span.start, end: this.loc() },
    };
  }

  private parseNamedCallExpression(callee: Expression): Expression {
    this.expect(TokenType.LeftBrace);
    const args: CallArgument[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const argStart = this.loc();
      const name = this.expect(TokenType.Identifier).value;

      if (this.match(TokenType.Colon)) {
        args.push({
          name,
          value: this.parseExpression(),
          span: this.span(argStart),
        });
      } else {
        args.push({
          name,
          value: {
            kind: "identifier",
            name,
            span: this.span(argStart),
          },
          span: this.span(argStart),
        });
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "call-expression",
      callee,
      args,
      span: { start: callee.span.start, end: this.loc() },
    };
  }

  // ===========================================================================
  // Primary Expressions
  // ===========================================================================

  private parsePrimary(): Expression {
    const startLoc = this.loc();

    // Integer literal
    if (this.check(TokenType.IntLiteral)) {
      const value = this.advance().value;
      return {
        kind: "int-literal",
        value: Number(value),
        span: this.span(startLoc),
      };
    }

    // Long literal
    if (this.check(TokenType.LongLiteral)) {
      const value = this.advance().value;
      return {
        kind: "long-literal",
        value: BigInt(value),
        span: this.span(startLoc),
      };
    }

    // Float literal
    if (this.check(TokenType.FloatLiteral)) {
      const value = this.advance().value;
      return {
        kind: "float-literal",
        value: Number(value),
        span: this.span(startLoc),
      };
    }

    // Double literal
    if (this.check(TokenType.DoubleLiteral)) {
      const value = this.advance().value;
      return {
        kind: "double-literal",
        value: Number(value),
        span: this.span(startLoc),
      };
    }

    // String literal (simple)
    if (this.check(TokenType.StringLiteral)) {
      const value = this.advance().value;
      return {
        kind: "string-literal",
        value,
        parts: [value],
        span: this.span(startLoc),
      };
    }

    // Template literal with interpolation
    if (this.check(TokenType.TemplateLiteralStart)) {
      return this.parseTemplateLiteral();
    }

    // Char literal
    if (this.check(TokenType.CharLiteral)) {
      const value = this.advance().value;
      return {
        kind: "char-literal",
        value,
        span: this.span(startLoc),
      };
    }

    // Boolean
    if (this.check(TokenType.True)) {
      this.advance();
      return { kind: "bool-literal", value: true, span: this.span(startLoc) };
    }
    if (this.check(TokenType.False)) {
      this.advance();
      return { kind: "bool-literal", value: false, span: this.span(startLoc) };
    }

    // Null
    if (this.check(TokenType.Null)) {
      this.advance();
      return { kind: "null-literal", span: this.span(startLoc) };
    }

    // this
    if (this.check(TokenType.This)) {
      this.advance();
      return { kind: "this-expression", span: this.span(startLoc) };
    }

    if (this.check(TokenType.CallerIntrinsic)) {
      this.advance();
      return { kind: "caller-expression", span: this.span(startLoc) };
    }

    // Readonly modifier on collection literal
    if (this.check(TokenType.Readonly) && this.peek(1).type === TokenType.LeftBracket) {
      this.advance();
      this.expect(TokenType.LeftBracket);
      const elements: Expression[] = [];
      while (!this.check(TokenType.RightBracket) && !this.isAtEnd()) {
        elements.push(this.parseExpression());
        if (!this.match(TokenType.Comma)) break;
      }
      this.expect(TokenType.RightBracket);
      return {
        kind: "array-literal",
        elements,
        readonly_: true,
        span: this.span(startLoc),
      };
    }

    // Dot shorthand for enum: .Variant
    if (this.check(TokenType.Dot) && this.peek(1).type === TokenType.Identifier) {
      this.advance(); // .
      const name = this.expect(TokenType.Identifier).value;
      return {
        kind: "dot-shorthand",
        name,
        span: this.span(startLoc),
      };
    }

    // Open-ended range: ..<expr
    if (this.check(TokenType.DotDotLess)) {
      this.advance();
      const end = this.parseAdditive();
      return {
        kind: "binary-expression",
        operator: "..<",
        left: { kind: "null-literal", span: this.span(startLoc) },
        right: end,
        span: this.span(startLoc),
      };
    }

    // If expression: if cond then expr else expr
    if (this.check(TokenType.If)) {
      return this.parseIfExpression();
    }

    // Case expression
    if (this.check(TokenType.Case)) {
      return this.parseCaseExpression();
    }

    // Catch expression: catch { ... }
    if (this.check(TokenType.Catch)) {
      return this.parseCatchExpression();
    }

    // Lambda: => expr (parameterless form)
    if (this.check(TokenType.Arrow)) {
      return this.parseParameterlessLambda();
    }

    // Array literal [...]
    if (this.check(TokenType.LeftBracket)) {
      return this.parseArrayLiteral();
    }

    // Parenthesized expression, tuple literal, or lambda with params
    if (this.check(TokenType.LeftParen)) {
      return this.parseParenOrTupleOrLambda();
    }

    // Object/map literal { ... }
    if (this.check(TokenType.LeftBrace)) {
      return this.parseObjectOrMapLiteral();
    }

    // Identifier (may be constructor call like `Point { ... }` or `Point(...)`)
    if (this.check(TokenType.Identifier)) {
      const name = this.advance().value;

      // Actor<ClassName>(args...) — actor creation expression
      if (name === "Actor" && this.check(TokenType.Less)) {
        return this.parseActorCreation(startLoc);
      }

      // Generic constructor with named fields: Name<T, U> { ... }
      if (this.check(TokenType.Less) && !this.inCaseSubject && this.looksLikeGenericConstruction()) {
        const typeArgs = this.parseGenericTypeArgs();
        if (this.check(TokenType.LeftBrace) && this.looksLikeConstructor()) {
          return this.parseNamedConstruction(name, startLoc, typeArgs, this.isCurrentTokenImmediatelyAfterPrevious());
        }
        if (this.check(TokenType.LeftParen) && this.isCurrentTokenOnSameLineAsPrevious()) {
          return this.parsePositionalConstruction(name, startLoc, typeArgs);
        }
      }

      // Constructor with named fields: Name { ... }
      if (this.check(TokenType.LeftBrace) && !this.inCaseSubject && this.looksLikeConstructor()) {
        return this.parseNamedConstruction(name, startLoc, [], this.isCurrentTokenImmediatelyAfterPrevious());
      }

      return {
        kind: "identifier",
        name,
        span: this.span(startLoc),
      };
    }

    throw this.error(`Unexpected token: ${this.current().type} ('${this.current().value}')`);
  }

  private parseActorCreation(startLoc: SourceLocation): ActorCreationExpression {
    // Already consumed "Actor", now expect <ClassName>(args...)
    this.expect(TokenType.Less);
    const className = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Greater);

    this.expect(TokenType.LeftParen);
    const args: Expression[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      args.push(this.parseExpression());
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightParen);

    return {
      kind: "actor-creation-expression",
      className,
      args,
      span: this.span(startLoc),
    };
  }

  private looksLikeConstructor(): boolean {
    // After `Name`, we see `{`. Check if it looks like named fields: { name: expr, ... }
    // vs block or other usage.
    // Heuristic: if the first token inside is `identifier:` or `...`, it's construction.
    if (this.peek(1).type === TokenType.Identifier && this.peek(2).type === TokenType.Colon) {
      return true;
    }
    if (this.peek(1).type === TokenType.Ellipsis) {
      return true;
    }
    // Shorthand: { name, ... } — identifier followed by comma or }
    if (this.peek(1).type === TokenType.Identifier &&
        (this.peek(2).type === TokenType.Comma || this.peek(2).type === TokenType.RightBrace)) {
      return true;
    }
    // Empty braces: Name {} — construct with no fields
    if (this.peek(1).type === TokenType.RightBrace) {
      return true;
    }
    return false;
  }

  /**
   * Lookahead: does `<...>` look like generic type args followed by construction syntax?
   * Current token must be `<`.
   * Scans for balanced `<` `>` with identifiers, commas, [], ? inside, then checks for `{` or `(`.
   */
  private looksLikeGenericConstruction(): boolean {
    let i = 0; // current token is <
    if (this.peek(i).type !== TokenType.Less) return false;
    let depth = 1;
    i++;
    while (depth > 0) {
      const t = this.peek(i);
      if (t.type === TokenType.EOF) return false;
      if (t.type === TokenType.Less) depth++;
      else if (t.type === TokenType.Greater) depth--;
      if (depth === 0) break;
      // Allow identifiers, commas, [], ?, and nested < > (for Map<string, int>)
      if (t.type !== TokenType.Identifier && t.type !== TokenType.Comma &&
          t.type !== TokenType.LeftBracket && t.type !== TokenType.RightBracket &&
          t.type !== TokenType.Less) {
        return false;
      }
      i++;
    }
    // After `>`, check for `{` or `(`
    const after = this.peek(i + 1);
    return after.type === TokenType.LeftBrace || after.type === TokenType.LeftParen;
  }

  /**
   * Parse generic type arguments: `<Type, Type, ...>`.
   * Current token must be `<`. Consumes through `>`.
   */
  private parseGenericTypeArgs(): TypeAnnotation[] {
    const typeArgs: TypeAnnotation[] = [];
    this.expect(TokenType.Less);
    typeArgs.push(this.parseTypeAnnotation());
    while (this.match(TokenType.Comma)) {
      typeArgs.push(this.parseTypeAnnotation());
    }
    this.expect(TokenType.Greater);
    return typeArgs;
  }

  private parseNamedConstruction(
    typeName: string,
    startLoc: SourceLocation,
    typeArgs: TypeAnnotation[] = [],
    tightBraces: boolean = false,
  ): Expression {
    this.expect(TokenType.LeftBrace);

    const properties: ObjectProperty[] = [];
    let spread: Expression | undefined;

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      // Spread
      if (this.check(TokenType.Ellipsis)) {
        this.advance();
        spread = this.parseExpression();
        if (!this.match(TokenType.Comma)) break;
        continue;
      }

      const propStart = this.loc();
      const name = this.expect(TokenType.Identifier).value;

      if (this.match(TokenType.Colon)) {
        const value = this.parseExpression();
        properties.push({
          kind: "object-property",
          name,
          value,
          span: this.span(propStart),
        });
      } else {
        // Shorthand: { name }
        properties.push({
          kind: "object-property",
          name,
          value: null,
          span: this.span(propStart),
        });
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "construct-expression",
      type: typeName,
      typeArgs,
      args: properties,
      named: true,
      tightBraces,
      span: this.span(startLoc),
    };
  }

  private parsePositionalConstruction(
    typeName: string,
    startLoc: SourceLocation,
    typeArgs: TypeAnnotation[] = [],
  ): Expression {
    this.expect(TokenType.LeftParen);

    const args: Expression[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      args.push(this.parseExpression());
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightParen);

    return {
      kind: "construct-expression",
      type: typeName,
      typeArgs,
      args,
      named: false,
      span: this.span(startLoc),
    };
  }

  private parseTemplateLiteral(): Expression {
    const startLoc = this.loc();
    const parts: (string | Expression)[] = [];

    // Start
    const startVal = this.expect(TokenType.TemplateLiteralStart).value;
    if (startVal) parts.push(startVal);

    // Parse interpolated expression
    parts.push(this.parseExpression());

    // Middle parts
    while (this.check(TokenType.TemplateLiteralMiddle)) {
      const mid = this.advance().value;
      if (mid) parts.push(mid);
      parts.push(this.parseExpression());
    }

    // End
    if (this.check(TokenType.TemplateLiteralEnd)) {
      const endVal = this.advance().value;
      if (endVal) parts.push(endVal);
    }

    // Build the combined string value (for simple cases)
    const value = parts.map(p => typeof p === "string" ? p : "${...}").join("");

    return {
      kind: "string-literal",
      value,
      parts,
      span: this.span(startLoc),
    };
  }

  private parseIfExpression(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.If);
    const condition = this.parseExpression();
    this.expect(TokenType.Then);
    const then = this.parseExpression();
    this.expect(TokenType.Else);
    const else_ = this.parseExpression();

    return {
      kind: "if-expression",
      condition,
      then,
      else_,
      span: this.span(startLoc),
    };
  }

  private parseCaseExpression(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.Case);
    const { subject, arms } = this.parseCaseBody("expression");

    return {
      kind: "case-expression",
      subject,
      arms,
      span: this.span(startLoc),
    };
  }

  private parseCaseStatement(): Statement {
    const startLoc = this.loc();
    this.expect(TokenType.Case);
    const { subject, arms } = this.parseCaseBody("statement");
    this.consumeOptionalSemicolon();

    return {
      kind: "case-statement",
      subject,
      arms,
      span: this.span(startLoc),
    };
  }

  private parseCatchExpression(): CatchExpression {
    const startLoc = this.loc();
    this.expect(TokenType.Catch);
    this.expect(TokenType.LeftBrace);

    const body: Statement[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      body.push(this.parseStatement());
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "catch-expression",
      body,
      span: this.span(startLoc),
    };
  }

  private parseCaseArm(form: CaseForm): CaseArm {
    const startLoc = this.loc();
    const patterns: CasePattern[] = [];

    patterns.push(this.parseCasePattern());
    while (this.match(TokenType.Pipe)) {
      patterns.push(this.parseCasePattern());
    }

    if (this.check(TokenType.Comma)) {
      throw this.error("Use '|' instead of ',' to separate multiple case patterns");
    }

    this.expect(TokenType.RightArrow, "Expected '->' in case arm");

    let body: Expression | Block;
    if (this.check(TokenType.LeftBrace)) {
      body = this.parseBlock();
    } else if (form === "statement" && this.isStatementCaseArmInlineStatementStart()) {
      body = this.parseInlineStatementCaseArmBody();
    } else {
      const prevInStatementCaseArmExpression = this.inStatementCaseArmExpression;
      const prevStatementCaseArmExpressionLine = this.statementCaseArmExpressionLine;
      if (form === "statement") {
        this.inStatementCaseArmExpression = true;
        this.statementCaseArmExpressionLine = this.current().line;
      }
      try {
        body = this.parseExpression();
      } finally {
        this.inStatementCaseArmExpression = prevInStatementCaseArmExpression;
        this.statementCaseArmExpressionLine = prevStatementCaseArmExpressionLine;
      }
    }

    return {
      kind: "case-arm",
      patterns,
      body,
      span: this.span(startLoc),
    };
  }

  private isStatementCaseArmInlineStatementStart(): boolean {
    return (
      this.check(TokenType.Return)
      || this.check(TokenType.Break)
      || this.check(TokenType.Continue)
      || this.check(TokenType.Try)
    );
  }

  private parseInlineStatementCaseArmBody(): Block {
    const statement = this.parseStatement();
    return {
      kind: "block",
      statements: [statement],
      span: statement.span,
    };
  }

  private parseCaseBody(form: CaseForm): { subject: Expression; arms: CaseArm[] } {
    this.inCaseSubject = true;
    const subject = this.parseExpression();
    this.inCaseSubject = false;
    this.expect(TokenType.LeftBrace);

    const arms: CaseArm[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      arms.push(this.parseCaseArm(form));

      if (form === "expression") {
        if (this.match(TokenType.Comma)) {
          if (this.check(TokenType.RightBrace)) break;
          continue;
        }

        if (!this.check(TokenType.RightBrace)) {
          throw this.error("Expected ',' between case expression arms");
        }
      } else if (this.check(TokenType.Comma)) {
        throw this.error("Commas are not allowed between case statement arms");
      }
    }

    this.expect(TokenType.RightBrace);
    return { subject, arms };
  }

  private parseCasePattern(): CasePattern {
    const startLoc = this.loc();

    // Wildcard: _
    if (this.check(TokenType.Underscore)) {
      this.advance();

      // _ : Type (discard with type pattern)
      if (this.match(TokenType.Colon)) {
        const type = this.parseTypeAnnotation();
        return {
          kind: "type-pattern",
          name: "_",
          type,
          span: this.span(startLoc),
        };
      }

      return { kind: "wildcard-pattern", span: this.span(startLoc) };
    }

    // Open-ended range: ..<expr
    if (this.check(TokenType.DotDotLess)) {
      this.advance();
      const end = this.parseAdditive();
      return {
        kind: "range-pattern",
        start: null,
        end,
        inclusive: false,
        span: this.span(startLoc),
      };
    }

    // Type pattern: name: Type or value pattern
    // We need to look ahead to distinguish `name: Type` from `value`
    if (this.check(TokenType.Identifier) && this.peek(1).type === TokenType.Colon) {
      // Could be type pattern: `s: Success` or value assignment
      const name = this.advance().value;
      this.advance(); // :
      const type = this.parseTypeAnnotation();
      return {
        kind: "type-pattern",
        name,
        type,
        span: this.span(startLoc),
      };
    }

    // Dot shorthand for enum: .Variant
    // Value or range pattern
    const value = this.parseAdditive();

    // Check for range
    if (this.check(TokenType.DotDot)) {
      this.advance();
      if (
        !this.check(TokenType.RightArrow) &&
        !this.check(TokenType.Comma) &&
        !this.check(TokenType.RightBrace) &&
        !this.isAtEnd()
      ) {
        const end = this.parseAdditive();
        return {
          kind: "range-pattern",
          start: value,
          end,
          inclusive: true,
          span: this.span(startLoc),
        };
      }
      // Open-ended: value..
      return {
        kind: "range-pattern",
        start: value,
        end: null,
        inclusive: true,
        span: this.span(startLoc),
      };
    }

    if (this.check(TokenType.DotDotLess)) {
      this.advance();
      const end = this.parseAdditive();
      return {
        kind: "range-pattern",
        start: value,
        end,
        inclusive: false,
        span: this.span(startLoc),
      };
    }

    return {
      kind: "value-pattern",
      value,
      span: this.span(startLoc),
    };
  }

  private parseParameterlessLambda(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.Arrow);

    let body: Expression | Block;
    if (this.check(TokenType.LeftBrace)) {
      body = this.parseBlock();
    } else {
      body = this.parseExpression();
    }

    return {
      kind: "lambda-expression",
      params: [],
      returnType: null,
      body,
      parameterless: true,
      trailing: false,
      span: this.span(startLoc),
    };
  }

  private parseArrayLiteral(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.LeftBracket);

    const elements: Expression[] = [];
    while (!this.check(TokenType.RightBracket) && !this.isAtEnd()) {
      elements.push(this.parseExpression());
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBracket);

    return {
      kind: "array-literal",
      elements,
      readonly_: false,
      span: this.span(startLoc),
    };
  }

  private parseParenOrTupleOrLambda(): Expression {
    // Try to determine if this is:
    // 1. Lambda: (params) => body  or  (params): RetType => body
    // 2. Tuple literal: (a, b, c)
    // 3. Parenthesized expression: (expr)

    if (this.looksLikeLambda()) {
      return this.parseLambdaExpression();
    }

    const startLoc = this.loc();
    this.expect(TokenType.LeftParen);

    // Empty parens — likely a unit/void
    if (this.check(TokenType.RightParen)) {
      this.advance();
      // Check for lambda: () => body
      if (this.check(TokenType.Arrow) || this.check(TokenType.Colon)) {
        return this.finishLambdaAfterParams([], startLoc);
      }
      // Empty tuple
      return {
        kind: "tuple-literal",
        elements: [],
        span: this.span(startLoc),
      };
    }

    const first = this.parseExpression();

    if (this.check(TokenType.Comma)) {
      // Tuple: (a, b, ...)
      const elements: Expression[] = [first];
      while (this.match(TokenType.Comma)) {
        if (this.check(TokenType.RightParen)) break;
        elements.push(this.parseExpression());
      }
      this.expect(TokenType.RightParen);
      return {
        kind: "tuple-literal",
        elements,
        span: this.span(startLoc),
      };
    }

    // Single parenthesized expression
    this.expect(TokenType.RightParen);
    return first;
  }

  private looksLikeLambda(): boolean {
    // (  )  =>
    // (  )  :
    // (  identifier  )  =>
    // (  identifier  :  type  ...  )  =>
    // (  identifier  ,  ...
    let i = 1; // past (
    const t = this.peek(i);

    // () => or ():
    if (t.type === TokenType.RightParen) {
      const after = this.peek(i + 1);
      return after.type === TokenType.Arrow || after.type === TokenType.Colon;
    }

    // (identifier ...) and check various lambda patterns
    if (t.type !== TokenType.Identifier) return false;

    const afterIdent = this.peek(i + 1);

    // (name) => or (name):
    if (afterIdent.type === TokenType.RightParen) {
      const afterParen = this.peek(i + 2);
      return afterParen.type === TokenType.Arrow || afterParen.type === TokenType.Colon;
    }

    // (name: type ...) — type annotation for parameter
    if (afterIdent.type === TokenType.Colon) {
      return true; // This is a lambda with typed params
    }

    // (name, ...) — could be tuple or lambda
    if (afterIdent.type === TokenType.Comma) {
      // Lookahead: scan to see if we find `) =>` or `): type =>`
      let depth = 1;
      let j = i + 2;
      while (depth > 0) {
        const tk = this.peek(j);
        if (tk.type === TokenType.EOF) return false;
        if (tk.type === TokenType.LeftParen) depth++;
        if (tk.type === TokenType.RightParen) depth--;
        j++;
      }
      const afterClose = this.peek(j);
      return afterClose.type === TokenType.Arrow || afterClose.type === TokenType.Colon;
    }

    return false;
  }

  private parseLambdaExpression(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.LeftParen);

    const params: Parameter[] = [];
    while (!this.check(TokenType.RightParen) && !this.isAtEnd()) {
      params.push(this.parseParameter());
      if (!this.match(TokenType.Comma)) break;
    }
    this.expect(TokenType.RightParen);

    return this.finishLambdaAfterParams(params, startLoc);
  }

  private finishLambdaAfterParams(params: Parameter[], startLoc: SourceLocation): Expression {
    let returnType: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      returnType = this.parseTypeAnnotation();
    }

    let body: Expression | Block;
    if (this.match(TokenType.Arrow)) {
      if (this.check(TokenType.LeftBrace)) {
        body = this.parseBlock();
      } else {
        body = this.parseExpression();
      }
    } else if (this.check(TokenType.LeftBrace)) {
      body = this.parseBlock();
    } else {
      throw this.error("Expected '=>' or '{' after lambda parameters");
    }

    return {
      kind: "lambda-expression",
      params,
      returnType,
      body,
      parameterless: false,
      trailing: false,
      span: this.span(startLoc),
    };
  }

  private parseObjectOrMapLiteral(): Expression {
    const startLoc = this.loc();
    this.expect(TokenType.LeftBrace);

    // Empty object
    if (this.check(TokenType.RightBrace)) {
      this.advance();
      return {
        kind: "object-literal",
        properties: [],
        span: this.span(startLoc),
      };
    }

    // Check if first element looks like map entry: [key]: value
    if (this.check(TokenType.LeftBracket)) {
      return this.parseMapLiteralBody(startLoc);
    }

    // Check if first element is dot-shorthand key: .Variant: value
    if (
      this.check(TokenType.Dot)
      && this.peek(1).type === TokenType.Identifier
      && this.peek(2).type === TokenType.Colon
    ) {
      return this.parseDotShorthandMapLiteralBody(startLoc);
    }

    // Check if first element is an explicit enum/member key: Color.Red: value
    if (
      this.check(TokenType.Identifier)
      && this.peek(1).type === TokenType.Dot
      && this.peek(2).type === TokenType.Identifier
      && this.peek(3).type === TokenType.Colon
    ) {
      return this.parseMemberKeyMapLiteralBody(startLoc);
    }

    // Check if first element is a bare literal key: 1: value, true: value, 'c': value
    if (
      this.isLiteralKeyToken(this.current().type)
      && this.peek(1).type === TokenType.Colon
    ) {
      return this.parseBareKeyMapLiteralBody(startLoc);
    }

    // Check for spread
    if (this.check(TokenType.Ellipsis)) {
      // Object with spread
    }

    // Named properties or shorthand
    const properties: ObjectProperty[] = [];
    let spread: Expression | undefined;

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      if (this.check(TokenType.Ellipsis)) {
        this.advance();
        spread = this.parseExpression();
        if (!this.match(TokenType.Comma)) break;
        continue;
      }

      const propStart = this.loc();

      // Check for string key: "key": value  (map-like)
      if (this.check(TokenType.StringLiteral) && this.peek(1).type === TokenType.Colon) {
        // This is a map literal with string keys
        return this.parseStringMapLiteralBody(startLoc, properties);
      }

      const name = this.expect(TokenType.Identifier).value;

      if (this.match(TokenType.Colon)) {
        const value = this.parseExpression();
        properties.push({
          kind: "object-property",
          name,
          value,
          span: this.span(propStart),
        });
      } else {
        // Shorthand
        properties.push({
          kind: "object-property",
          name,
          value: null,
          span: this.span(propStart),
        });
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "object-literal",
      properties,
      spread,
      span: this.span(startLoc),
    };
  }

  /** Returns true if the token type can be used as a bare (unbracketed) map key. */
  private isLiteralKeyToken(type: TokenType): boolean {
    return type === TokenType.IntLiteral
      || type === TokenType.LongLiteral
      || type === TokenType.FloatLiteral
      || type === TokenType.DoubleLiteral
      || type === TokenType.CharLiteral
      || type === TokenType.True
      || type === TokenType.False;
  }

  private parseBareKeyMapLiteralBody(startLoc: SourceLocation): Expression {
    const entries: MapEntry[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const entryStart = this.loc();
      const key = this.parsePrimary();
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value, span: this.span(entryStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "map-literal",
      entries,
      span: this.span(startLoc),
    };
  }

  private parseMapLiteralBody(startLoc: SourceLocation): Expression {
    const entries: MapEntry[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const entryStart = this.loc();
      this.expect(TokenType.LeftBracket);
      const key = this.parseExpression();
      this.expect(TokenType.RightBracket);
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value, span: this.span(entryStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "map-literal",
      entries,
      span: this.span(startLoc),
    };
  }

  private parseStringMapLiteralBody(
    startLoc: SourceLocation,
    _prevProps: ObjectProperty[],
  ): Expression {
    // We already parsed some properties but now found string keys.
    // Re-interpret as a string-keyed map and continue accepting either
    // quoted keys or bare identifier keys for ergonomic JSON-style literals.
    const entries: MapEntry[] = [];

    // Parse remaining as map entries
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const entryStart = this.loc();
      let keyValue: string;
      if (this.check(TokenType.StringLiteral)) {
        keyValue = this.expect(TokenType.StringLiteral).value;
      } else {
        keyValue = this.expect(TokenType.Identifier).value;
      }
      const key: Expression = {
        kind: "string-literal",
        value: keyValue,
        parts: [],
        span: this.span(entryStart),
      };
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value, span: this.span(entryStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "map-literal",
      entries,
      span: this.span(startLoc),
    };
  }

  private parseDotShorthandMapLiteralBody(startLoc: SourceLocation): Expression {
    const entries: MapEntry[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const entryStart = this.loc();
      this.expect(TokenType.Dot);
      const name = this.expect(TokenType.Identifier).value;
      const key: Expression = {
        kind: "dot-shorthand",
        name,
        span: this.span(entryStart),
      };
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value, span: this.span(entryStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "map-literal",
      entries,
      span: this.span(startLoc),
    };
  }

  private parseMemberKeyMapLiteralBody(startLoc: SourceLocation): Expression {
    const entries: MapEntry[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      const entryStart = this.loc();
      const key = this.parsePostfix();
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      entries.push({ key, value, span: this.span(entryStart) });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RightBrace);

    return {
      kind: "map-literal",
      entries,
      span: this.span(startLoc),
    };
  }
}

export function parse(source: string): Program {
  return new Parser().parse(source);
}

/** Parse with additional diagnostic information from the lexer. */
export function parseWithDiagnostics(source: string): { program: Program; lexerDiagnostics: LexerDiagnostic[] } {
  const parser = new Parser();
  const program = parser.parse(source);
  return { program, lexerDiagnostics: parser.lexerDiagnostics };
}
