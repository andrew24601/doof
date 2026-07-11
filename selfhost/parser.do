// Recursive-descent / precedence-climbing parser for the self-hosted compiler.
//
// This is deliberately kept close to src/parser.ts.  The parser owns syntax
// only: names are left unresolved and AST nodes contain source spans for later
// analysis and diagnostics.

import { Lexer, Token, TokenType, tokenValue } from "./lexer"
import {
  Program, Block, NamedType, Parameter, FunctionTypeParam, ClassField,
  InterfaceField, EnumVariant, Identifier, IfBranch, CallArgument,
  ObjectProperty, ExportSpecifier, SourceSpan, AstLocation,
  FunctionDeclaration, ConstDeclaration, ReadonlyDeclaration, LetDeclaration,
  ImmutableBinding, ImportDeclaration, NamespaceImport, NamedImport,
  TypeAliasDeclaration, ClassDeclaration, InterfaceDeclaration, EnumDeclaration,
  ExportList,
  IfStatement, WhileStatement, ForOfStatement, ForStatement, WithBinding,
  WithStatement, BreakStatement, ContinueStatement, ReturnStatement,
  YieldStatement, ExpressionStatement, DestructuringStatement, UnionType,
  ArrayType, FunctionType, AssignmentExpression, BinaryExpression,
  UnaryExpression, MemberExpression, IndexExpression, CallExpression,
  IntLiteral, LongLiteral, FloatLiteral, DoubleLiteral, ArrayLiteral,
  StringLiteral, CharLiteral, BoolLiteral, NullLiteral,
  ThisExpression, CallerExpression, IfExpression, LambdaExpression,
  TupleLiteral, ObjectLiteral, ConstructExpression, DotShorthand,
} from "./ast"
import type { Statement, Expression, TypeAnnotation, ImportSpecifier } from "./ast"

export class Parser {
  readonly source: string
  tokens: Token[] = []
  pos: int = 0

  function parse(): Program {
    lexer := Lexer { source }
    tokens = lexer.tokenize()
    pos = 0
    start := location()
    let statements: Statement[] = []
    while !atEnd() { statements.push(parseStatement()) }
    return Program { kind: "program", statements, span: span(start) }
  }

  // --------------------------------------------------------------------------
  // Token helpers
  // --------------------------------------------------------------------------

  private function current(): Token { return tokens[pos] }

  private function peek(offset: int = 0): Token {
    index := pos + offset
    if index >= tokens.length { return tokens[tokens.length - 1] }
    return tokens[index]
  }

  private function atEnd(): bool { return current().kind == TokenType.EndOfFile }

  private function advance(): Token {
    token := current()
    if !atEnd() { pos = pos + 1 }
    return token
  }

  private function check(kind: TokenType): bool { return current().kind == kind }

  private function match(kind: TokenType): bool {
    if !check(kind) { return false }
    advance()
    return true
  }

  private function expect(kind: TokenType, message: string = ""): Token {
    if check(kind) { return advance() }
    let errorMessage = message
    if errorMessage == "" { errorMessage = "Expected " + expectedLabel(kind) + " before '" + currentText() + "'" }
    fail(errorMessage)
    return current()
  }

  private function fail(message: string): void {
    token := current()
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

  private function text(token: Token): string { return tokenValue(token, source) }
  private function currentText(): string { return text(current()) }

  private function location(): AstLocation {
    token := current()
    return AstLocation { line: token.line, column: token.column, offset: token.offset }
  }

  private function span(start: AstLocation): SourceSpan {
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

  private function sameLineAsPrevious(): bool {
    if pos == 0 { return false }
    return tokens[pos - 1].line == current().line
  }

  private function immediatelyAfterPrevious(): bool {
    if pos == 0 { return false }
    previous := tokens[pos - 1]
    return previous.offset + previous.length == current().offset
  }

  private function consumeSemicolon(): void { match(TokenType.Semicolon) }

  // --------------------------------------------------------------------------
  // Statements and declarations
  // --------------------------------------------------------------------------

  private function parseStatement(): Statement {
    if check(TokenType.Export) { return parseExport() }
    if check(TokenType.Import) { return parseImport() }
    if check(TokenType.Const) { return parseConst(false) }
    if check(TokenType.Readonly) { return parseReadonly(false) }
    if check(TokenType.Let) { return parseLet() }
    if check(TokenType.Function) { return parseFunction(false, false, false, false) }
    if check(TokenType.Isolated) && peek(1).kind == TokenType.Function {
      advance()
      return parseFunction(false, false, true, false)
    }
    if check(TokenType.Class) || check(TokenType.Struct) { return parseClass(false, false) }
    if check(TokenType.Private) {
      advance()
      if check(TokenType.Function) { return parseFunction(false, false, false, true) }
      if check(TokenType.Class) || check(TokenType.Struct) { return parseClass(false, true) }
      fail("Expected function, class, or struct after private")
    }
    if check(TokenType.Interface) { return parseInterface(false) }
    if check(TokenType.Enum) { return parseEnum(false) }
    if check(TokenType.Type) { return parseTypeAlias(false) }
    if check(TokenType.Return) { return parseReturn() }
    if check(TokenType.Yield) { return parseYield() }
    if check(TokenType.If) { return parseIfStatement() }
    if check(TokenType.While) { return parseWhile(null) }
    if check(TokenType.For) { return parseFor(null) }
    if check(TokenType.With) { return parseWith() }
    if check(TokenType.Break) { return parseBreak() }
    if check(TokenType.Continue) { return parseContinue() }

    if check(TokenType.Identifier) {
      if peek(1).kind == TokenType.Colon && looksLikeTypedImmutableBinding() {
        return parseTypedImmutableBinding()
      }
    }
    if check(TokenType.LeftBracket) {
      if looksLikePattern(colonEqualToken()) {
        return parseDestructuring("array", "immutable", colonEqualToken())
      }
    }
    if check(TokenType.LeftParen) {
      if looksLikePattern(colonEqualToken()) {
        return parseDestructuring("positional", "immutable", colonEqualToken())
      }
    }
    if check(TokenType.LeftBrace) { fail("Bare block statements are not allowed") }

    return parseExpressionStatement()
  }

  private function parseExport(): Statement {
    start := location()
    expect(TokenType.Export)
    if check(TokenType.Const) { return parseConst(true) }
    if check(TokenType.Readonly) { return parseReadonly(true) }
    if check(TokenType.Function) { return parseFunction(true, false, false, false) }
    if check(TokenType.Class) || check(TokenType.Struct) { return parseClass(true, false) }
    if check(TokenType.Interface) { return parseInterface(true) }
    if check(TokenType.Enum) { return parseEnum(true) }
    if check(TokenType.Type) { return parseTypeAlias(true) }
    if check(TokenType.Identifier) || check(TokenType.LeftBrace) {
      expect(TokenType.LeftBrace)
      let specifiers: ExportSpecifier[] = []
      while !check(TokenType.RightBrace) && !atEnd() {
        itemStart := location()
        name := text(expect(TokenType.Identifier))
        let alias: string | null = null
        if match(TokenType.As) { alias = text(expect(TokenType.Identifier)) }
        specifiers.push(ExportSpecifier { name, alias, span: span(itemStart) })
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.RightBrace)
      let sourceValue: string | null = null
      if match(TokenType.From) { sourceValue = text(expect(TokenType.StringLiteral)) }
      consumeSemicolon()
      return ExportList { kind: "export-list", specifiers, source: sourceValue, span: span(start) }
    }
    fail("Expected a declaration or export list after export")
    return ExportList { kind: "export-list", specifiers: [], source: null, span: span(start) }
  }

  private function parseConst(exported: bool): Statement {
    start := location()
    expect(TokenType.Const)
    name := text(expect(TokenType.Identifier))
    typeValue := parseOptionalType()
    value := parseInitializer()
    consumeSemicolon()
    return ConstDeclaration { kind: "const-declaration", name, type_: typeValue, value, exported, span: span(start) }
  }

  private function parseReadonly(exported: bool): Statement {
    start := location()
    expect(TokenType.Readonly)
    name := text(expect(TokenType.Identifier))
    typeValue := parseOptionalType()
    value := parseInitializer()
    consumeSemicolon()
    return ReadonlyDeclaration { kind: "readonly-declaration", name, type_: typeValue, value, exported, span: span(start) }
  }

  private function parseLet(): Statement {
    start := location()
    expect(TokenType.Let)
    if check(TokenType.LeftBracket) && looksLikePattern(TokenType.Equal) {
      return parseDestructuring("array", "let", TokenType.Equal)
    }
    if check(TokenType.LeftParen) && looksLikePattern(TokenType.Equal) {
      return parseDestructuring("positional", "let", TokenType.Equal)
    }
    name := text(expect(TokenType.Identifier))
    typeValue := parseOptionalType()
    value := parseInitializer()
    consumeSemicolon()
    return LetDeclaration { kind: "let-declaration", name, type_: typeValue, value, span: span(start) }
  }

  private function parseInitializer(): Expression {
    if match(TokenType.Equal) { return parseExpression() }
    fail("Expected '=' in declaration")
    return Identifier { kind: "identifier", name: "<error>", span: locationSpan() }
  }

  private function parseFunction(exported: bool, static_: bool, isolated_: bool, private_: bool): FunctionDeclaration {
    start := location()
    expect(TokenType.Function)
    name := text(expect(TokenType.Identifier))
    typeParams := parseTypeParameterNames()
    expect(TokenType.LeftParen)
    params := parseParameters()
    expect(TokenType.RightParen)
    returnType := parseOptionalType()
    if check(TokenType.Arrow) {
      body := parseExpressionBody()
      return makeFunction(name, typeParams, params, returnType, body, exported, static_, isolated_, private_, start)
    }
    body := parseBlock()
    return makeFunction(name, typeParams, params, returnType, body, exported, static_, isolated_, private_, start)
  }

  private function makeFunction(name: string, typeParams: string[], params: Parameter[], returnType: TypeAnnotation | null, body: Expression | Block, exported: bool, static_: bool, isolated_: bool, private_: bool, start: AstLocation): FunctionDeclaration {
    return FunctionDeclaration {
      kind: "function-declaration", name, typeParams, params, returnType, body,
      exported, static_, isolated_, private_, span: span(start),
    }
  }

  private function parseExpressionBody(): Expression {
    expect(TokenType.Arrow)
    value := parseExpression()
    consumeSemicolon()
    return value
  }

  private function parseTypeParameterNames(): string[] {
    names: string[] := []
    if !match(TokenType.Less) { return names }
    while !check(TokenType.Greater) && !atEnd() {
      names.push(text(expect(TokenType.Identifier)))
      if !match(TokenType.Colon) { }
      if check(TokenType.Colon) { parseTypeAnnotation() }
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.Greater)
    return names
  }

  private function parseParameters(): Parameter[] {
    params: Parameter[] := []
    while !check(TokenType.RightParen) && !atEnd() {
      start := location()
      name := text(expect(TokenType.Identifier))
      typeValue := parseOptionalType()
      let defaultValue: Expression | null = null
      if match(TokenType.Equal) { defaultValue = parseExpression() }
      params.push(Parameter { name, type_: typeValue, defaultValue, span: span(start) })
      if !match(TokenType.Comma) { break }
    }
    return params
  }

  private function parseClass(exported: bool, private_: bool): Statement {
    start := location()
    advance()
    name := text(expect(TokenType.Identifier))
    typeParams := parseTypeParameterNames()
    let implements_: NamedType[] = []
    if match(TokenType.Implements) {
      implements_.push(parseNamedType())
      while match(TokenType.Comma) { implements_.push(parseNamedType()) }
    }
    expect(TokenType.LeftBrace)
    let fields: ClassField[] = []
    let methods: FunctionDeclaration[] = []
    while !check(TokenType.RightBrace) && !atEnd() {
      if check(TokenType.Function) {
        methods.push(parseFunction(false, false, false, false))
      } else if check(TokenType.Static) && peek(1).kind == TokenType.Function {
        advance()
        methods.push(parseFunction(false, true, false, false))
      } else if check(TokenType.Private) && peek(1).kind == TokenType.Function {
        advance()
        methods.push(parseFunction(false, false, false, true))
      } else {
        fields.push(parseClassField(false, false))
      }
    }
    expect(TokenType.RightBrace)
    return ClassDeclaration { kind: "class-declaration", name, typeParams, implements_, fields, methods, exported, private_, span: span(start) }
  }

  private function parseNamedType(): NamedType {
    start := location()
    name := text(expect(TokenType.Identifier))
    let typeArgs: TypeAnnotation[] = []
    if match(TokenType.Less) {
      while !check(TokenType.Greater) && !atEnd() {
        typeArgs.push(parseTypeAnnotation())
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.Greater)
    }
    return NamedType { kind: "named-type", name, typeArgs, span: span(start) }
  }

  private function parseClassField(static_: bool, private_: bool): ClassField {
    start := location()
    let staticValue = static_
    readonly_ := match(TokenType.Readonly)
    if match(TokenType.Static) { staticValue = true }
    let names: string[] = [text(expect(TokenType.Identifier))]
    while match(TokenType.Comma) { names.push(text(expect(TokenType.Identifier))) }
    typeValue := parseOptionalType()
    let defaultValue: Expression | null = null
    if match(TokenType.Equal) { defaultValue = parseExpression() }
    consumeSemicolon()
    return ClassField { kind: "class-field", names, type_: typeValue, defaultValue, static_: staticValue, readonly_, private_, span: span(start) }
  }

  private function parseInterface(exported: bool): Statement {
    start := location()
    expect(TokenType.Interface)
    name := text(expect(TokenType.Identifier))
    typeParams := parseTypeParameterNames()
    expect(TokenType.LeftBrace)
    let fields: InterfaceField[] = []
    let methods: FunctionDeclaration[] = []
    while !check(TokenType.RightBrace) && !atEnd() {
      memberStart := location()
      memberName := text(expect(TokenType.Identifier))
      if check(TokenType.LeftParen) {
        expect(TokenType.LeftParen)
        params := parseParameters()
        expect(TokenType.RightParen)
        returnType := parseOptionalType()
        consumeSemicolon()
        methods.push(FunctionDeclaration {
          kind: "function-declaration", name: memberName, typeParams: [], params,
          returnType, body: Block { kind: "block", statements: [], span: span(memberStart) },
          exported: false, static_: false, isolated_: false, private_: false,
          span: span(memberStart),
        })
      } else {
        expect(TokenType.Colon)
        typeValue := parseTypeAnnotation()
        consumeSemicolon()
        fields.push(InterfaceField { kind: "interface-field", name: memberName, type_: typeValue, span: span(memberStart) })
      }
    }
    expect(TokenType.RightBrace)
    return InterfaceDeclaration { kind: "interface-declaration", name, typeParams, fields, methods, exported, span: span(start) }
  }

  private function parseEnum(exported: bool): Statement {
    start := location()
    expect(TokenType.Enum)
    name := text(expect(TokenType.Identifier))
    expect(TokenType.LeftBrace)
    let variants: EnumVariant[] = []
    while !check(TokenType.RightBrace) && !atEnd() {
      variantStart := location()
      variantName := text(expect(TokenType.Identifier))
      let value: Expression | null = null
      if match(TokenType.Equal) { value = parseExpression() }
      variants.push(EnumVariant { kind: "enum-variant", name: variantName, value, span: span(variantStart) })
      if !match(TokenType.Comma) { consumeSemicolon() }
    }
    expect(TokenType.RightBrace)
    return EnumDeclaration { kind: "enum-declaration", name, variants, exported, span: span(start) }
  }

  private function parseTypeAlias(exported: bool): Statement {
    start := location()
    expect(TokenType.Type)
    name := text(expect(TokenType.Identifier))
    typeParams := parseTypeParameterNames()
    expect(TokenType.Equal)
    typeValue := parseTypeAnnotation()
    consumeSemicolon()
    return TypeAliasDeclaration { kind: "type-alias-declaration", name, typeParams, type_: typeValue, exported, span: span(start) }
  }

  private function parseImport(): Statement {
    start := location()
    expect(TokenType.Import)
    typeOnly := match(TokenType.Type)
    let specifiers: ImportSpecifier[] = []
    if match(TokenType.Star) {
      match(TokenType.As)
      alias := text(expect(TokenType.Identifier))
      specifiers.push(NamespaceImport { kind: "namespace-import-specifier", alias, span: span(start) })
    } else {
      expect(TokenType.LeftBrace)
      while !check(TokenType.RightBrace) && !atEnd() {
        itemStart := location()
        name := text(expect(TokenType.Identifier))
        let alias: string | null = null
        if match(TokenType.As) { alias = text(expect(TokenType.Identifier)) }
        specifiers.push(NamedImport { kind: "named-import-specifier", name, alias, span: span(itemStart) })
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.RightBrace)
    }
    expect(TokenType.From)
    sourceValue := text(expect(TokenType.StringLiteral))
    consumeSemicolon()
    return ImportDeclaration { kind: "import-declaration", specifiers, source: sourceValue, typeOnly, span: span(start) }
  }

  private function parseReturn(): Statement {
    start := location()
    expect(TokenType.Return)
    if check(TokenType.RightBrace) || check(TokenType.EndOfFile) || check(TokenType.Semicolon) {
      consumeSemicolon()
      return ReturnStatement { kind: "return-statement", value: null, span: span(start) }
    }
    value := parseExpression()
    consumeSemicolon()
    return ReturnStatement { kind: "return-statement", value, span: span(start) }
  }

  private function parseYield(): Statement {
    start := location()
    expect(TokenType.Yield)
    value := parseExpression()
    consumeSemicolon()
    return YieldStatement { kind: "yield-statement", value, span: span(start) }
  }

  private function parseIfStatement(): Statement {
    start := location()
    expect(TokenType.If)
    condition := parseExpression()
    body := parseBlock()
    let elseIfs: IfBranch[] = []
    let else_: Block | null = null
    while match(TokenType.Else) {
      if match(TokenType.If) {
        branchStart := location()
        branchCondition := parseExpression()
        branchBody := parseBlock()
        elseIfs.push(IfBranch { condition: branchCondition, body: branchBody, span: span(branchStart) })
      } else {
        else_ = parseBlock()
        break
      }
    }
    return IfStatement { kind: "if-statement", condition, body, elseIfs, else_, span: span(start) }
  }

  private function parseWhile(label: string | null): Statement {
    start := location()
    expect(TokenType.While)
    condition := parseExpression()
    body := parseBlock()
    let then_: Block | null = null
    if match(TokenType.Then) { then_ = parseBlock() }
    return WhileStatement { kind: "while-statement", condition, body, label, then_, span: span(start) }
  }

  private function parseFor(label: string | null): Statement {
    start := location()
    expect(TokenType.For)
    if check(TokenType.Identifier) && peek(1).kind == TokenType.Of {
      let bindings: string[] = [text(advance())]
      while match(TokenType.Comma) { bindings.push(text(expect(TokenType.Identifier))) }
      expect(TokenType.Of)
      iterable := parseExpression()
      body := parseBlock()
      let then_: Block | null = null
      if match(TokenType.Then) { then_ = parseBlock() }
      return ForOfStatement { kind: "for-of-statement", bindings, iterable, body, label, then_, span: span(start) }
    }
    let init: Statement | null = null
    if !check(TokenType.Semicolon) {
      if check(TokenType.Let) { init = parseLetNoSemicolon() }
      else { init = parseExpressionStatementNoSemicolon() }
    }
    expect(TokenType.Semicolon)
    let condition: Expression | null = null
    if !check(TokenType.Semicolon) { condition = parseExpression() }
    expect(TokenType.Semicolon)
    let update: Expression[] = []
    while !check(TokenType.LeftBrace) && !atEnd() {
      update.push(parseExpression())
      if !match(TokenType.Comma) { break }
    }
    body := parseBlock()
    let then_: Block | null = null
    if match(TokenType.Then) { then_ = parseBlock() }
    return ForStatement { kind: "for-statement", init, condition, update, body, label, then_, span: span(start) }
  }

  private function parseLetNoSemicolon(): Statement {
    start := location()
    expect(TokenType.Let)
    name := text(expect(TokenType.Identifier))
    typeValue := parseOptionalType()
    value := parseInitializer()
    return LetDeclaration { kind: "let-declaration", name, type_: typeValue, value, span: span(start) }
  }

  private function parseExpressionStatementNoSemicolon(): Statement {
    start := location()
    value := parseExpression()
    return ExpressionStatement { kind: "expression-statement", expression: value, span: span(start) }
  }

  private function parseWith(): Statement {
    start := location()
    expect(TokenType.With)
    let bindings: WithBinding[] = []
    while !check(TokenType.LeftBrace) && !atEnd() {
      bindingStart := location()
      name := text(expect(TokenType.Identifier))
      typeValue := parseOptionalType()
      expect(TokenType.ColonEqual)
      value := parseExpression()
      bindings.push(WithBinding { name, type_: typeValue, value, span: span(bindingStart) })
      if !match(TokenType.Comma) { break }
    }
    body := parseBlock()
    return WithStatement { kind: "with-statement", bindings, body, span: span(start) }
  }

  private function parseBreak(): Statement {
    start := location()
    expect(TokenType.Break)
    let label: string | null = null
    if check(TokenType.Identifier) && sameLineAsPrevious() { label = text(advance()) }
    consumeSemicolon()
    return BreakStatement { kind: "break-statement", label, span: span(start) }
  }

  private function parseContinue(): Statement {
    start := location()
    expect(TokenType.Continue)
    let label: string | null = null
    if check(TokenType.Identifier) && sameLineAsPrevious() { label = text(advance()) }
    consumeSemicolon()
    return ContinueStatement { kind: "continue-statement", label, span: span(start) }
  }

  private function parseBlock(): Block {
    start := location()
    expect(TokenType.LeftBrace)
    let statements: Statement[] = []
    while !check(TokenType.RightBrace) && !atEnd() { statements.push(parseStatement()) }
    expect(TokenType.RightBrace)
    return Block { kind: "block", statements, span: span(start) }
  }

  private function looksLikePattern(separator: TokenType): bool {
    let depth = 0
    let index = 0
    while index < 128 {
      token := peek(index)
      if token.kind == TokenType.EndOfFile { return false }
      if token.kind == TokenType.LeftBracket || token.kind == TokenType.LeftParen || token.kind == TokenType.LeftBrace { depth = depth + 1 }
      if token.kind == TokenType.RightBracket || token.kind == TokenType.RightParen || token.kind == TokenType.RightBrace { depth = depth - 1 }
      if depth == 0 && token.kind == separator { return true }
      if depth == 0 && token.kind == TokenType.Equal { return separator == TokenType.Equal }
      index = index + 1
    }
    return false
  }

  private function colonEqualToken(): TokenType { return TokenType.ColonEqual }

  private function parseDestructuring(shape: string, bindingKind: string, separator: TokenType): Statement {
    start := location()
    close := if shape == "array" then TokenType.RightBracket else TokenType.RightParen
    open := if shape == "array" then TokenType.LeftBracket else TokenType.LeftParen
    expect(open)
    let bindings: string[] = []
    while !check(close) && !atEnd() {
      if check(TokenType.Underscore) { bindings.push("_"); advance() }
      else { bindings.push(text(expect(TokenType.Identifier))) }
      if !match(TokenType.Comma) { break }
    }
    expect(close)
    expect(separator)
    value := parseExpression()
    consumeSemicolon()
    let kind = if shape == "array" then "array-destructuring" else "positional-destructuring"
    if separator == TokenType.Equal { kind = kind + "-assignment" }
    return DestructuringStatement { kind, bindings, bindingKind, value, span: span(start) }
  }

  private function parseExpressionStatement(): Statement {
    start := location()
    if check(TokenType.Identifier) && peek(1).kind == TokenType.ColonEqual {
      name := text(advance())
      advance()
      rhs := parseExpression()
      consumeSemicolon()
      return ImmutableBinding { kind: "immutable-binding", name, type_: null, value: rhs, exported: false, span: span(start) }
    }
    value := parseExpression()
    consumeSemicolon()
    return ExpressionStatement { kind: "expression-statement", expression: value, span: span(start) }
  }

  private function looksLikeTypedImmutableBinding(): bool {
    let index = 2
    while index < 64 {
      token := peek(index)
      if token.kind == TokenType.EndOfFile || token.kind == TokenType.Semicolon || token.kind == TokenType.LeftBrace { return false }
      if token.kind == TokenType.ColonEqual { return true }
      index = index + 1
    }
    return false
  }

  private function parseTypedImmutableBinding(): Statement {
    start := location()
    name := text(expect(TokenType.Identifier))
    expect(TokenType.Colon)
    typeValue := parseTypeAnnotation()
    expect(TokenType.ColonEqual)
    value := parseExpression()
    consumeSemicolon()
    return ImmutableBinding { kind: "immutable-binding", name, type_: typeValue, value, exported: false, span: span(start) }
  }

  // --------------------------------------------------------------------------
  // Types
  // --------------------------------------------------------------------------

  private function parseOptionalType(): TypeAnnotation | null {
    if !match(TokenType.Colon) { return null }
    return parseTypeAnnotation()
  }

  private function parseTypeAnnotation(): TypeAnnotation {
    first := parseTypeMember()
    let types: TypeAnnotation[] = [first]
    while match(TokenType.Pipe) { types.push(parseTypeMember()) }
    let result: TypeAnnotation = first
    if types.length > 1 { result = UnionType { kind: "union-type", types, span: SourceSpan { start: first.span.start, end: types[types.length - 1].span.end } } }
    return result
  }

  private function parseTypeMember(): TypeAnnotation {
    let result = parsePrimaryType()
    while check(TokenType.LeftBracket) && peek(1).kind == TokenType.RightBracket {
      start := result.span.start
      advance()
      advance()
      result = ArrayType { kind: "array-type", elementType: result, readonly_: false, span: SourceSpan { start, end: location() } }
    }
    return result
  }

  private function parsePrimaryType(): TypeAnnotation {
    start := location()
    if check(TokenType.LeftParen) {
      if peek(1).kind != TokenType.RightParen && !(peek(1).kind == TokenType.Identifier && peek(2).kind == TokenType.Colon) {
        advance()
        inner := parseTypeAnnotation()
        expect(TokenType.RightParen)
        return inner
      }
      advance()
      let params: FunctionTypeParam[] = []
      while !check(TokenType.RightParen) && !atEnd() {
        paramStart := location()
        paramName := text(expect(TokenType.Identifier))
        expect(TokenType.Colon)
        paramType := parseTypeAnnotation()
        params.push(FunctionTypeParam { name: paramName, type_: paramType, span: span(paramStart) })
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.RightParen)
      expect(TokenType.Colon)
      returnType := parseTypeAnnotation()
      return FunctionType { kind: "function-type", params, returnType, span: span(start) }
    }
    nameToken := advance()
    if nameToken.kind != TokenType.Identifier && nameToken.kind != TokenType.Void && nameToken.kind != TokenType.Null {
      fail("Expected a type name")
    }
    name := text(nameToken)
    let typeArgs: TypeAnnotation[] = []
    if match(TokenType.Less) {
      while !check(TokenType.Greater) && !atEnd() {
        typeArgs.push(parseTypeAnnotation())
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.Greater)
    }
    return NamedType { kind: "named-type", name, typeArgs, span: span(start) }
  }

  // --------------------------------------------------------------------------
  // Expressions
  // --------------------------------------------------------------------------

  private function parseExpression(): Expression { return parseAssignment() }

  private function parseAssignment(): Expression {
    let left = parseNullCoalescing()
    if isAssignmentOperator(current().kind) {
      start := left.span.start
      operator := operatorText(advance())
      right := parseAssignment()
      return AssignmentExpression { kind: "assignment-expression", operator, target: left, value: right, span: SourceSpan { start, end: right.span.end } }
    }
    return left
  }

  private function parseNullCoalescing(): Expression { return parseBinaryLevel(0) }
  private function parseLogicalOr(): Expression { return parseBinaryLevel(1) }
  private function parseLogicalAnd(): Expression { return parseBinaryLevel(2) }
  private function parseBitwiseOr(): Expression { return parseBinaryLevel(3) }
  private function parseBitwiseXor(): Expression { return parseBinaryLevel(4) }
  private function parseBitwiseAnd(): Expression { return parseBinaryLevel(5) }
  private function parseEquality(): Expression { return parseBinaryLevel(6) }
  private function parseComparison(): Expression { return parseBinaryLevel(7) }
  private function parseShift(): Expression {
    let left = parseRange()
    while check(TokenType.LessLess) || check(TokenType.GreaterGreater) || check(TokenType.GreaterGreaterGreater) {
      operator := operatorText(advance())
      right := parseAdditive()
      left = BinaryExpression { kind: "binary-expression", operator, left, right, span: SourceSpan { start: left.span.start, end: right.span.end } }
    }
    return left
  }
  private function parseAdditive(): Expression { return parseBinaryLevel(9) }
  private function parseMultiplicative(): Expression { return parseBinaryLevel(10) }

  private function parseRange(): Expression {
    let left = parseAdditive()
    if check(TokenType.DotDot) || check(TokenType.DotDotLess) {
      operator := operatorText(advance())
      right := parseAdditive()
      return BinaryExpression { kind: "binary-expression", operator, left, right, span: SourceSpan { start: left.span.start, end: right.span.end } }
    }
    return left
  }

  private function parseExponentiation(): Expression {
    left := parseUnary()
    if match(TokenType.StarStar) {
      right := parseExponentiation()
      return BinaryExpression { kind: "binary-expression", operator: "**", left, right, span: SourceSpan { start: left.span.start, end: right.span.end } }
    }
    return left
  }

  private function parseBinaryLevel(level: int): Expression {
    if level == 0 { return parseBinaryLoop(parseLogicalOr(), [TokenType.QuestionQuestion], 0) }
    if level == 1 { return parseBinaryLoop(parseLogicalAnd(), [TokenType.PipePipe], 1) }
    if level == 2 { return parseBinaryLoop(parseBitwiseOr(), [TokenType.AmpersandAmpersand], 2) }
    if level == 3 { return parseBinaryLoop(parseBitwiseXor(), [TokenType.Pipe], 3) }
    if level == 4 { return parseBinaryLoop(parseBitwiseAnd(), [TokenType.Caret], 4) }
    if level == 5 { return parseBinaryLoop(parseEquality(), [TokenType.Ampersand], 5) }
    if level == 6 { return parseBinaryLoop(parseComparison(), [TokenType.EqualEqual, TokenType.BangEqual], 6) }
    if level == 7 { return parseBinaryLoop(parseShift(), [TokenType.Less, TokenType.LessEqual, TokenType.Greater, TokenType.GreaterEqual], 7) }
    if level == 8 { return parseBinaryLoop(parseAdditive(), [TokenType.LessLess, TokenType.GreaterGreater, TokenType.GreaterGreaterGreater], 8) }
    if level == 9 { return parseBinaryLoop(parseMultiplicative(), [TokenType.Plus, TokenType.Minus], 9) }
    return parseBinaryLoop(parseExponentiation(), [TokenType.Star, TokenType.Slash, TokenType.Backslash, TokenType.Percent], 10)
  }

  private function parseBinaryLoop(initial: Expression, kinds: TokenType[], level: int): Expression {
    let left = initial
    while contains(kinds, current().kind) {
      operator := operatorText(advance())
      right := if level == 0 then parseLogicalOr() else if level == 1 then parseLogicalAnd() else if level == 2 then parseBitwiseOr() else if level == 3 then parseBitwiseXor() else if level == 4 then parseBitwiseAnd() else if level == 5 then parseEquality() else if level == 6 then parseComparison() else if level == 7 then parseShift() else if level == 8 then parseAdditive() else if level == 9 then parseMultiplicative() else parseExponentiation()
      left = BinaryExpression { kind: "binary-expression", operator, left, right, span: SourceSpan { start: left.span.start, end: right.span.end } }
    }
    return left
  }

  private function contains(values: TokenType[], value: TokenType): bool {
    for item of values { if item == value { return true } }
    return false
  }

  private function parseUnary(): Expression {
    if check(TokenType.Bang) || check(TokenType.Minus) || check(TokenType.Plus) || check(TokenType.Tilde) {
      start := location()
      operator := operatorText(advance())
      operand := parseUnary()
      return UnaryExpression { kind: "unary-expression", operator, operand, prefix: true, span: SourceSpan { start, end: operand.span.end } }
    }
    return parsePostfix()
  }

  private function parseIfExpression(): Expression {
    start := location()
    expect(TokenType.If)
    condition := parseExpression()
    expect(TokenType.Then)
    thenValue := parseExpression()
    expect(TokenType.Else)
    elseValue := parseExpression()
    return IfExpression { kind: "if-expression", condition, then_: thenValue, else_: elseValue, span: span(start) }
  }

  private function parsePostfix(): Expression {
    let expression = parsePrimary()
    while true {
      if check(TokenType.Dot) || check(TokenType.QuestionDot) || check(TokenType.BangDot) {
        optional := check(TokenType.QuestionDot)
        force := check(TokenType.BangDot)
        advance()
        property := text(expect(TokenType.Identifier, "Expected member name"))
        expression = MemberExpression { kind: "member-expression", object: expression, property, optional, force, span: SourceSpan { start: expression.span.start, end: location() } }
      } else if check(TokenType.LeftBracket) || check(TokenType.QuestionBracket) {
        optional := check(TokenType.QuestionBracket)
        advance()
        index := parseExpression()
        expect(TokenType.RightBracket)
        expression = IndexExpression { kind: "index-expression", object: expression, index, optional, span: SourceSpan { start: expression.span.start, end: location() } }
      } else if check(TokenType.LeftParen) {
        expression = parseCall(expression)
      } else if check(TokenType.Bang) && sameLineAsPrevious() {
        advance()
        expression = UnaryExpression { kind: "non-null-assertion", operator: "!", operand: expression, prefix: false, span: SourceSpan { start: expression.span.start, end: location() } }
      } else {
        break
      }
    }
    return expression
  }

  private function parseCall(callee: Expression): Expression {
    expect(TokenType.LeftParen)
    let args: CallArgument[] = []
    while !check(TokenType.RightParen) && !atEnd() {
      start := location()
      value := parseExpression()
      args.push(CallArgument { name: null, value, span: span(start) })
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.RightParen)
    return CallExpression { kind: "call-expression", callee, args, span: SourceSpan { start: callee.span.start, end: location() } }
  }

  private function parseNamedCall(callee: Expression): Expression {
    expect(TokenType.LeftBrace)
    let args: CallArgument[] = []
    while !check(TokenType.RightBrace) && !atEnd() {
      start := location()
      name := text(expect(TokenType.Identifier))
      let value: Expression = Identifier { kind: "identifier", name, span: span(start) }
      if match(TokenType.Colon) { value = parseExpression() }
      args.push(CallArgument { name, value, span: span(start) })
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.RightBrace)
    return CallExpression { kind: "call-expression", callee, args, span: SourceSpan { start: callee.span.start, end: location() } }
  }

  private function parsePrimary(): Expression {
    start := location()
    if check(TokenType.IntLiteral) {
      value := parseIntValue(text(advance()))
      return IntLiteral { kind: "int-literal", value, span: span(start) }
    }
    if check(TokenType.LongLiteral) {
      value := parseLongValue(text(advance()))
      return LongLiteral { kind: "long-literal", value, span: span(start) }
    }
    if check(TokenType.FloatLiteral) {
      value := float(parseDoubleValue(text(advance()).replaceAll("f", "").replaceAll("F", "")))
      return FloatLiteral { kind: "float-literal", value, span: span(start) }
    }
    if check(TokenType.DoubleLiteral) {
      value := parseDoubleValue(text(advance()))
      return DoubleLiteral { kind: "double-literal", value, span: span(start) }
    }
    if check(TokenType.StringLiteral) || check(TokenType.TemplateLiteralStart) || check(TokenType.TemplateLiteralMiddle) {
      return parseStringLiteral()
    }
    if check(TokenType.CharLiteral) {
      value := tokenValue(advance(), source)
      let charValue = '\0'
      if value.length > 0 { charValue = value[0] }
      return CharLiteral { kind: "char-literal", value: charValue, span: span(start) }
    }
    if match(TokenType.True) { return BoolLiteral { kind: "bool-literal", value: true, span: span(start) } }
    if match(TokenType.False) { return BoolLiteral { kind: "bool-literal", value: false, span: span(start) } }
    if match(TokenType.Null) { return NullLiteral { kind: "null-literal", span: span(start) } }
    if match(TokenType.This) { return ThisExpression { kind: "this-expression", span: span(start) } }
    if match(TokenType.CallerIntrinsic) { return CallerExpression { kind: "caller-expression", span: span(start) } }
    if check(TokenType.If) { return parseIfExpression() }
    if check(TokenType.Arrow) { return parseParameterlessLambda() }
    if check(TokenType.LeftBracket) { return parseArrayLiteral() }
    if check(TokenType.LeftParen) { return parseParenExpression() }
    if check(TokenType.LeftBrace) { return parseObjectLiteral() }
    if check(TokenType.Dot) && peek(1).kind == TokenType.Identifier {
      advance()
      return DotShorthand { kind: "dot-shorthand", name: text(expect(TokenType.Identifier)), span: span(start) }
    }
    if check(TokenType.Identifier) {
      name := text(advance())
      if check(TokenType.Dot) {
        advance()
        property := text(expect(TokenType.Identifier, "Expected member name"))
        return MemberExpression { kind: "member-expression", object: Identifier { kind: "identifier", name, span: span(start) }, property, optional: false, force: false, span: span(start) }
      }
      let typeArgs: TypeAnnotation[] = []
      if check(TokenType.Less) && looksLikeGenericTypeArguments() {
        advance()
        while !check(TokenType.Greater) && !atEnd() {
          typeArgs.push(parseTypeAnnotation())
          if !match(TokenType.Comma) { break }
        }
        expect(TokenType.Greater)
      }
      if check(TokenType.LeftBrace) && startsWithUppercase(name) {
        return parseConstruction(start, name, typeArgs)
      }
      return Identifier { kind: "identifier", name, span: span(start) }
    }
    fail("Expected an expression")
    return NullLiteral { kind: "null-literal", span: span(start) }
  }

  private function parseStringLiteral(): Expression {
    start := location()
    let parts: string[] = []
    let interpolations: Expression[] = []
    if check(TokenType.StringLiteral) {
      value := tokenValue(advance(), source)
      parts.push(value)
      return StringLiteral { kind: "string-literal", value, parts, interpolations, span: span(start) }
    }
    let value = ""
    if check(TokenType.TemplateLiteralStart) {
      raw := tokenValue(advance(), source)
      parts.push(raw)
      value = value + raw
      expression := parseExpression()
      interpolations.push(expression)
      parts.push("<expression>")
      value = value + "<expression>"
    }
    while check(TokenType.TemplateLiteralMiddle) {
      raw := tokenValue(advance(), source)
      parts.push(raw)
      value = value + raw
      expression := parseExpression()
      interpolations.push(expression)
      parts.push("<expression>")
      value = value + "<expression>"
    }
    if check(TokenType.TemplateLiteralEnd) {
      raw := tokenValue(advance(), source)
      parts.push(raw)
      value = value + raw
    }
    return StringLiteral { kind: "string-literal", value, parts, interpolations, span: span(start) }
  }

  private function parseArrayLiteral(): Expression {
    start := location()
    expect(TokenType.LeftBracket)
    let elements: Expression[] = []
    while !check(TokenType.RightBracket) && !atEnd() {
      elements.push(parseExpression())
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.RightBracket)
    return ArrayLiteral { kind: "array-literal", elements, readonly_: false, span: span(start) }
  }

  private function parseParenExpression(): Expression {
    start := location()
    expect(TokenType.LeftParen)
    if check(TokenType.RightParen) {
      advance()
      if check(TokenType.Arrow) || check(TokenType.Colon) { return finishLambda([], start) }
      return TupleLiteral { kind: "tuple-literal", elements: [], span: span(start) }
    }
    first := parseExpression()
    if match(TokenType.Comma) {
      let elements: Expression[] = [first]
      while !check(TokenType.RightParen) && !atEnd() {
        elements.push(parseExpression())
        if !match(TokenType.Comma) { break }
      }
      expect(TokenType.RightParen)
      if check(TokenType.Arrow) || check(TokenType.Colon) { return finishLambda([], start) }
      return TupleLiteral { kind: "tuple-literal", elements, span: span(start) }
    }
    expect(TokenType.RightParen)
    return first
  }

  private function finishLambda(params: Parameter[], start: AstLocation): Expression {
    returnType := parseOptionalType()
    expect(TokenType.Arrow)
    if check(TokenType.LeftBrace) {
      body := parseBlock()
      return makeLambda(params, returnType, body, start)
    }
    body := parseExpression()
    return makeLambda(params, returnType, body, start)
  }

  private function makeLambda(params: Parameter[], returnType: TypeAnnotation | null, body: Expression | Block, start: AstLocation): Expression {
    return LambdaExpression { kind: "lambda-expression", params, returnType, body, parameterless: params.length == 0, trailing: false, span: span(start) }
  }

  private function parseParameterlessLambda(): Expression {
    start := location()
    expect(TokenType.Arrow)
    if check(TokenType.LeftBrace) {
      body := parseBlock()
      return LambdaExpression { kind: "lambda-expression", params: [], returnType: null, body, parameterless: true, trailing: false, span: span(start) }
    }
    body := parseExpression()
    return LambdaExpression { kind: "lambda-expression", params: [], returnType: null, body, parameterless: true, trailing: false, span: span(start) }
  }

  private function parseObjectLiteral(): Expression {
    start := location()
    expect(TokenType.LeftBrace)
    let properties: ObjectProperty[] = []
    let spread: Expression | null = null
    while !check(TokenType.RightBrace) && !atEnd() {
      if match(TokenType.Ellipsis) {
        spread = parseExpression()
      } else {
        propertyStart := location()
        name := text(expect(TokenType.Identifier))
        let value: Expression | null = null
        if match(TokenType.Colon) { value = parseExpression() }
        properties.push(ObjectProperty { name, value, span: span(propertyStart) })
      }
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.RightBrace)
    return ObjectLiteral { kind: "object-literal", properties, spread, span: span(start) }
  }

  private function parseConstruction(start: AstLocation, name: string, typeArgs: TypeAnnotation[]): Expression {
    expect(TokenType.LeftBrace)
    let properties: ObjectProperty[] = []
    while !check(TokenType.RightBrace) && !atEnd() {
      propertyStart := location()
      propertyName := text(expect(TokenType.Identifier))
      let value: Expression | null = null
      if match(TokenType.Colon) { value = parseExpression() }
      properties.push(ObjectProperty { name: propertyName, value, span: span(propertyStart) })
      if !match(TokenType.Comma) { break }
    }
    expect(TokenType.RightBrace)
    return ConstructExpression { kind: "construct-expression", type_: name, typeArgs, args: properties, named: true, span: span(start) }
  }

  private function looksLikeGenericTypeArguments(): bool {
    let depth = 0
    let index = 0
    while index < 64 {
      token := peek(index)
      if token.kind == TokenType.Less { depth = depth + 1 }
      if token.kind == TokenType.Greater {
        depth = depth - 1
        if depth == 0 {
          next := peek(index + 1).kind
          return next == TokenType.LeftBrace || next == TokenType.LeftParen
        }
      }
      if token.kind == TokenType.EndOfFile || token.kind == TokenType.Semicolon || token.kind == TokenType.LeftBrace && depth == 0 { return false }
      index = index + 1
    }
    return false
  }

  private function parseIntValue(raw: string): int {
    let base = 10
    let index = 0
    if raw.length >= 2 && raw[0] == '0' && (raw[1] == 'x' || raw[1] == 'X') {
      base = 16
      index = 2
    } else if raw.length >= 2 && raw[0] == '0' && (raw[1] == 'b' || raw[1] == 'B') {
      base = 2
      index = 2
    }
    let result = 0
    while index < raw.length {
      ch := raw[index]
      if ch == '_' { index = index + 1; continue }
      digit := digitValue(ch)
      result = result * base + digit
      index = index + 1
    }
    return result
  }

  private function parseLongValue(raw: string): long {
    clean := raw.replaceAll("L", "").replaceAll("l", "")
    return long(parseIntValue(clean))
  }

  private function digitValue(ch: char): int {
    if ch == '0' { return 0 }
    if ch == '1' { return 1 }
    if ch == '2' { return 2 }
    if ch == '3' { return 3 }
    if ch == '4' { return 4 }
    if ch == '5' { return 5 }
    if ch == '6' { return 6 }
    if ch == '7' { return 7 }
    if ch == '8' { return 8 }
    if ch == '9' { return 9 }
    if ch == 'a' || ch == 'A' { return 10 }
    if ch == 'b' || ch == 'B' { return 11 }
    if ch == 'c' || ch == 'C' { return 12 }
    if ch == 'd' || ch == 'D' { return 13 }
    if ch == 'e' || ch == 'E' { return 14 }
    return 15
  }

  private function parseDoubleValue(raw: string): double {
    let dot = -1
    for i of 0..<raw.length { if raw[i] == '.' { dot = i; break } }
    if dot < 0 { return double(parseIntValue(raw)) }
    whole := parseIntValue(raw.substring(0, dot))
    fractionText := raw.substring(dot + 1, raw.length)
    fraction := parseIntValue(fractionText)
    let divisor = 1.0
    for i of 0..<fractionText.length { divisor = divisor * 10.0 }
    return double(whole) + double(fraction) / divisor
  }

  private function isAssignmentOperator(kind: TokenType): bool {
    return kind == TokenType.Equal || kind == TokenType.PlusEqual || kind == TokenType.MinusEqual ||
      kind == TokenType.StarEqual || kind == TokenType.SlashEqual || kind == TokenType.BackslashEqual ||
      kind == TokenType.PercentEqual || kind == TokenType.StarStarEqual || kind == TokenType.AmpersandEqual ||
      kind == TokenType.PipeEqual || kind == TokenType.CaretEqual || kind == TokenType.LessLessEqual ||
      kind == TokenType.GreaterGreaterEqual || kind == TokenType.QuestionQuestionEqual
  }

  private function startsWithUppercase(name: string): bool {
    if name.length == 0 { return false }
    return name[0] >= 'A' && name[0] <= 'Z'
  }

  private function operatorText(token: Token): string { return text(token) }
  private function locationSpan(): SourceSpan { start := location(); return SourceSpan { start, end: start } }
}

export function parse(source: string): Program { return Parser { source }.parse() }
