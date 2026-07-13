// Declaration and import/export parsing for the self-hosted parser.

import type { Parser } from "./parser"
import { Token, TokenType } from "./lexer"
import {
  Block, NamedType, Parameter, ClassField,
  InterfaceField, EnumVariant, ExportSpecifier, AstLocation,
  Identifier, ConstDeclaration, ReadonlyDeclaration, LetDeclaration,
  FunctionDeclaration, ImportDeclaration, NamespaceImport, NamedImport,
  TypeAliasDeclaration, ClassDeclaration, InterfaceDeclaration, EnumDeclaration,
  ExportList,
} from "./ast"
import type { Statement, Expression, TypeAnnotation, ImportSpecifier } from "./ast"

export function parseExport(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Export)
  if parser.check(TokenType.Import) {
    parser.advance()
    if parser.check(TokenType.Class) { return parseNativeClass(parser, true, start) }
    if parser.check(TokenType.Function) { return parseNativeFunction(parser, true, start) }
    parser.fail("Expected class after export import")
  }
  if parser.check(TokenType.Const) { return parseConst(parser, true) }
  if parser.check(TokenType.Readonly) { return parseReadonly(parser, true) }
  if parser.check(TokenType.Function) { return parseFunction(parser, true, false, false, false) }
  if parser.check(TokenType.Class) || parser.check(TokenType.Struct) { return parseClass(parser, true, false) }
  if parser.check(TokenType.Interface) { return parseInterface(parser, true) }
  if parser.check(TokenType.Enum) { return parseEnum(parser, true) }
  if parser.check(TokenType.Type) { return parseTypeAlias(parser, true) }
  if parser.check(TokenType.Identifier) || parser.check(TokenType.LeftBrace) {
    parser.expect(TokenType.LeftBrace)
    let specifiers: ExportSpecifier[] = []
    while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
      itemStart := parser.location()
      name := parser.text(parser.expect(TokenType.Identifier))
      let alias: string | null = null
      if parser.match(TokenType.As) { alias = parser.text(parser.expect(TokenType.Identifier)) }
      specifiers.push(ExportSpecifier { name, alias, span: parser.span(itemStart) })
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.RightBrace)
    let sourceValue: string | null = null
    if parser.match(TokenType.From) { sourceValue = parser.text(parser.expect(TokenType.StringLiteral)) }
    parser.consumeSemicolon()
    return ExportList { kind: "export-list", specifiers, source: sourceValue, span: parser.span(start) }
  }
  parser.fail("Expected a declaration or export list after export")
  return ExportList { kind: "export-list", specifiers: [], source: null, span: parser.span(start) }
}

export function parseConst(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Const)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return ConstDeclaration { kind: "const-declaration", name, type_: typeValue, value, exported, span: parser.span(start) }
}

export function parseReadonly(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Readonly)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return ReadonlyDeclaration { kind: "readonly-declaration", name, type_: typeValue, value, exported, span: parser.span(start) }
}

export function parseLet(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Let)
  if parser.check(TokenType.LeftBracket) && parser.looksLikePattern(TokenType.Equal) {
    return parser.parseDestructuring("array", "let", TokenType.Equal)
  }
  if parser.check(TokenType.LeftParen) && parser.looksLikePattern(TokenType.Equal) {
    return parser.parseDestructuring("positional", "let", TokenType.Equal)
  }
  name := parser.text(parser.expect(TokenType.Identifier))
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return LetDeclaration { kind: "let-declaration", name, type_: typeValue, value, span: parser.span(start) }
}

function parseInitializer(parser: Parser): Expression {
  if parser.match(TokenType.Equal) { return parser.parseExpression() }
  parser.fail("Expected '=' in declaration")
  return Identifier { kind: "identifier", name: "<error>", span: parser.locationSpan() }
}

export function parseFunction(parser: Parser, exported: bool, static_: bool, isolated_: bool, private_: bool): FunctionDeclaration {
  start := parser.location()
  parser.expect(TokenType.Function)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeParams := parseTypeParameterNames(parser)
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  returnType := parser.parseOptionalType()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return makeFunctionExpression(parser, name, typeParams, params, returnType, body, exported, static_, isolated_, private_, start)
  }
  body := parser.parseBlock()
  return makeFunctionBlock(parser, name, typeParams, params, returnType, body, exported, static_, isolated_, private_, start)
}

function parseMethod(parser: Parser, static_: bool, private_: bool): FunctionDeclaration {
  start := parser.location()
  name := parser.text(parser.expect(TokenType.Identifier))
  typeParams := parseTypeParameterNames(parser)
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  returnType := parser.parseOptionalType()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return makeFunctionExpression(parser, name, typeParams, params, returnType, body, false, static_, false, private_, start)
  }
  body := parser.parseBlock()
  return makeFunctionBlock(parser, name, typeParams, params, returnType, body, false, static_, false, private_, start)
}

function makeFunctionExpression(parser: Parser, name: string, typeParams: string[], params: Parameter[], returnType: TypeAnnotation | null, body: Expression, exported: bool, static_: bool, isolated_: bool, private_: bool, start: AstLocation): FunctionDeclaration {
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams, params, returnType, body: body,
    exported, static_, isolated_, private_, bodyless: false, span: parser.span(start),
  }
}

function makeFunctionBlock(parser: Parser, name: string, typeParams: string[], params: Parameter[], returnType: TypeAnnotation | null, body: Block, exported: bool, static_: bool, isolated_: bool, private_: bool, start: AstLocation): FunctionDeclaration {
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams, params, returnType, body: body,
    exported, static_, isolated_, private_, bodyless: false, span: parser.span(start),
  }
}

function parseExpressionBody(parser: Parser): Expression {
  parser.expect(TokenType.Arrow)
  value := parser.parseExpression()
  parser.consumeSemicolon()
  return value
}

function parseTypeParameterNames(parser: Parser): string[] {
  names: string[] := []
  if !parser.match(TokenType.Less) { return names }
  while !parser.check(TokenType.Greater) && !parser.atEnd() {
    names.push(parser.text(parser.expect(TokenType.Identifier)))
    if !parser.match(TokenType.Colon) { }
    if parser.check(TokenType.Colon) { parser.parseTypeAnnotation() }
    if !parser.match(TokenType.Comma) { break }
  }
  parser.expect(TokenType.Greater)
  return names
}

function parseParameters(parser: Parser): Parameter[] {
  params: Parameter[] := []
  while !parser.check(TokenType.RightParen) && !parser.atEnd() {
    start := parser.location()
    name := parser.text(parser.expect(TokenType.Identifier))
    typeValue := parser.parseOptionalType()
    let defaultValue: Expression | null = null
    if parser.match(TokenType.Equal) { defaultValue = parser.parseExpression() }
    params.push(Parameter { name, type_: typeValue, defaultValue, span: parser.span(start) })
    if !parser.match(TokenType.Comma) { break }
  }
  return params
}

export function parseClass(parser: Parser, exported: bool, private_: bool): Statement {
  start := parser.location()
  struct_ := parser.check(TokenType.Struct)
  parser.advance()
  name := parser.text(parser.expect(TokenType.Identifier))
  // Class descriptions are metadata for tooling; the self-hosted AST does
  // not currently retain them, but they must not block stdlib parsing.
  if parser.check(TokenType.StringLiteral) { parser.advance() }
  typeParams := parseTypeParameterNames(parser)
  let implements_: NamedType[] = []
  if parser.match(TokenType.Implements) {
    implements_.push(parseNamedType(parser))
    while parser.match(TokenType.Comma) { implements_.push(parseNamedType(parser)) }
  }
  parser.expect(TokenType.LeftBrace)

  let fields: ClassField[] = []
  let methods: FunctionDeclaration[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    if parser.check(TokenType.Function) {
      methods.push(parseFunction(parser, false, false, false, false))
    } else if parser.check(TokenType.Static) && parser.peek(1).kind == TokenType.Function {
      parser.advance()
      methods.push(parseFunction(parser, false, true, false, false))
    } else if parser.check(TokenType.Private) && parser.peek(1).kind == TokenType.Function {
      parser.advance()
      methods.push(parseFunction(parser, false, false, false, true))
    } else if parser.check(TokenType.Private) {
      parser.advance()
      if parser.check(TokenType.Function) {
        methods.push(parseFunction(parser, false, false, false, true))
      } else if parser.check(TokenType.Identifier) && (parser.peek(1).kind == TokenType.LeftParen || parser.peek(1).kind == TokenType.Less) {
        methods.push(parseMethod(parser, false, true))
      } else if parser.check(TokenType.Static) {
        parser.advance()
        if parser.check(TokenType.Identifier) && (parser.peek(1).kind == TokenType.LeftParen || parser.peek(1).kind == TokenType.Less) {
          methods.push(parseMethod(parser, true, true))
        } else {
          fields.push(parseClassField(parser, true, true))
        }
      } else {
        fields.push(parseClassField(parser, false, true))
      }
    } else if parser.check(TokenType.Destructor) {
      // Destructors are runtime-only cleanup hooks.  The self-hosted AST
      // has no destructor node yet, but consuming the body keeps std/time
      // source compatible for analysis of its public types.
      parser.advance()
      parser.parseBlock()
    } else if parser.check(TokenType.Static) {
      if checkAheadMethod(parser, 1) {
        parser.advance()
        methods.push(parseMethod(parser, true, false))
      } else {
        parser.advance()
        fields.push(parseClassField(parser, true, false))
      }
    } else if parser.check(TokenType.Identifier) && (parser.peek(1).kind == TokenType.LeftParen || parser.peek(1).kind == TokenType.Less) {
      methods.push(parseMethod(parser, false, false))
    } else {
      fields.push(parseClassField(parser, false, false))
    }
  }
  parser.expect(TokenType.RightBrace)
  return ClassDeclaration { kind: "class-declaration", name, struct_, typeParams, implements_, fields, methods, exported, private_, span: parser.span(start) }
}

function checkAheadMethod(parser: Parser, offset: int): bool {
  return parser.peek(offset).kind == TokenType.Identifier &&
    (parser.peek(offset + 1).kind == TokenType.LeftParen || parser.peek(offset + 1).kind == TokenType.Less)
}

function parseNamedType(parser: Parser): NamedType {
  start := parser.location()
  name := parser.text(parser.expect(TokenType.Identifier))
  let typeArgs: TypeAnnotation[] = []
  if parser.match(TokenType.Less) {
    while !parser.check(TokenType.Greater) && !parser.atEnd() {
      typeArgs.push(parser.parseTypeAnnotation())
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.Greater)
  }
  return NamedType { kind: "named-type", name, typeArgs, span: parser.span(start) }
}

function parseClassField(parser: Parser, static_: bool, private_: bool): ClassField {
  start := parser.location()
  let staticValue = static_
  readonly_ := parser.match(TokenType.Readonly)
  if parser.match(TokenType.Static) { staticValue = true }
  let names: string[] = [parser.text(parser.expect(TokenType.Identifier))]
  while parser.match(TokenType.Comma) { names.push(parser.text(parser.expect(TokenType.Identifier))) }
  typeValue := parser.parseOptionalType()
  let defaultValue: Expression | null = null
  if parser.match(TokenType.Equal) { defaultValue = parser.parseExpression() }
  parser.consumeSemicolon()
  return ClassField { kind: "class-field", names, type_: typeValue, defaultValue, static_: staticValue, readonly_, private_, span: parser.span(start) }
}

export function parseInterface(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Interface)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeParams := parseTypeParameterNames(parser)
  parser.expect(TokenType.LeftBrace)
  let fields: InterfaceField[] = []
  let methods: FunctionDeclaration[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    memberStart := parser.location()
    memberName := parser.text(parser.expect(TokenType.Identifier))
    if parser.check(TokenType.LeftParen) {
      parser.expect(TokenType.LeftParen)
      params := parseParameters(parser)
      parser.expect(TokenType.RightParen)
      returnType := parser.parseOptionalType()
      parser.consumeSemicolon()
      methods.push(FunctionDeclaration {
        kind: "function-declaration", name: memberName, typeParams: [], params,
        returnType, body: Block { kind: "block", statements: [], span: parser.span(memberStart) },
        exported: false, static_: false, isolated_: false, private_: false,
        bodyless: true,
        span: parser.span(memberStart),
      })
    } else {
      parser.expect(TokenType.Colon)
      typeValue := parser.parseTypeAnnotation()
      parser.consumeSemicolon()
      fields.push(InterfaceField { kind: "interface-field", name: memberName, type_: typeValue, span: parser.span(memberStart) })
    }
  }
  parser.expect(TokenType.RightBrace)
  return InterfaceDeclaration { kind: "interface-declaration", name, typeParams, fields, methods, exported, span: parser.span(start) }
}

export function parseEnum(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Enum)
  name := parser.text(parser.expect(TokenType.Identifier))
  parser.expect(TokenType.LeftBrace)
  let variants: EnumVariant[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    variantStart := parser.location()
    variantName := parser.text(parser.expect(TokenType.Identifier))
    let enumValue: Expression | null = null
    if parser.match(TokenType.Equal) { enumValue = parser.parseExpression() }
    variants.push(EnumVariant { kind: "enum-variant", name: variantName, value: enumValue, span: parser.span(variantStart) })
    if !parser.match(TokenType.Comma) { parser.consumeSemicolon() }
  }
  parser.expect(TokenType.RightBrace)
  return EnumDeclaration { kind: "enum-declaration", name, variants, exported, span: parser.span(start) }
}

export function parseTypeAlias(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Type)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeParams := parseTypeParameterNames(parser)
  parser.expect(TokenType.Equal)
  typeValue := parser.parseTypeAnnotation()
  parser.consumeSemicolon()
  return TypeAliasDeclaration { kind: "type-alias-declaration", name, typeParams, type_: typeValue, exported, span: parser.span(start) }
}

export function parseImport(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Import)
  if parser.check(TokenType.Class) { return parseNativeClass(parser, false, start) }
  if parser.check(TokenType.Function) { return parseNativeFunction(parser, false, start) }
  typeOnly := parser.match(TokenType.Type)
  let specifiers: ImportSpecifier[] = []
  if parser.match(TokenType.Star) {
    parser.match(TokenType.As)
    alias := parser.text(parser.expect(TokenType.Identifier))
    specifiers.push(NamespaceImport { kind: "namespace-import-specifier", alias, span: parser.span(start) })
  } else {
    parser.expect(TokenType.LeftBrace)
    while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
      itemStart := parser.location()
      name := parser.text(parser.expect(TokenType.Identifier))
      let alias: string | null = null
      if parser.match(TokenType.As) { alias = parser.text(parser.expect(TokenType.Identifier)) }
      specifiers.push(NamedImport { kind: "named-import-specifier", name, alias, span: parser.span(itemStart) })
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.RightBrace)
  }
  parser.expect(TokenType.From)
  sourceValue := parser.text(parser.expect(TokenType.StringLiteral))
  parser.consumeSemicolon()
  return ImportDeclaration { kind: "import-declaration", specifiers, source: sourceValue, typeOnly, span: parser.span(start) }
}

function parseNativeClass(parser: Parser, exported: bool, start: AstLocation): ClassDeclaration {
  parser.expect(TokenType.Class)
  name := parser.text(parser.expect(TokenType.Identifier))
  let headerPath = ""
  if parser.match(TokenType.From) { headerPath = parser.text(parser.expect(TokenType.StringLiteral)) }
  let cppName = ""
  if parser.match(TokenType.As) { cppName = parseCppQualifiedName(parser) }

  parser.expect(TokenType.LeftBrace)
  let fields: ClassField[] = []
  let methods: FunctionDeclaration[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    if (parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.LeftParen) ||
        (parser.check(TokenType.Static) && parser.peek(1).kind == TokenType.Identifier && parser.peek(2).kind == TokenType.LeftParen) {
      methods.push(parseNativeMethod(parser))
    } else {
      fields.push(parseClassField(parser, false, false))
    }
  }
  parser.expect(TokenType.RightBrace)
  return ClassDeclaration {
    kind: "class-declaration", name, typeParams: [], implements_: [], fields, methods,
    exported, private_: false, native_: true, nativeHeader: headerPath, nativeCppName: cppName,
    span: parser.span(start),
  }
}

function parseNativeMethod(parser: Parser): FunctionDeclaration {
  start := parser.location()
  static_ := parser.match(TokenType.Static)
  name := parser.text(parser.expect(TokenType.Identifier))
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  parser.expect(TokenType.Colon)
  returnType := parser.parseTypeAnnotation()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return FunctionDeclaration {
      kind: "function-declaration", name, typeParams: [], params, returnType, body,
      exported: false, static_, isolated_: false, private_: false, bodyless: false,
      span: parser.span(start),
    }
  }
  if parser.check(TokenType.LeftBrace) {
    body := parser.parseBlock()
    return FunctionDeclaration {
      kind: "function-declaration", name, typeParams: [], params, returnType, body,
      exported: false, static_, isolated_: false, private_: false, bodyless: false,
      span: parser.span(start),
    }
  }
  parser.consumeSemicolon()
  body := Block { kind: "block", statements: [], span: parser.span(start) }
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams: [], params, returnType, body,
    exported: false, static_, isolated_: false, private_: false, bodyless: true,
    span: parser.span(start),
  }
}

function parseNativeFunction(parser: Parser, exported: bool, start: AstLocation): FunctionDeclaration {
  parser.expect(TokenType.Function)
  name := parser.text(parser.expect(TokenType.Identifier))
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  parser.expect(TokenType.Colon)
  returnType := parser.parseTypeAnnotation()
  let headerPath = ""
  if parser.match(TokenType.From) { headerPath = parser.text(parser.expect(TokenType.StringLiteral)) }
  let cppName = ""
  if parser.match(TokenType.As) { cppName = parseCppQualifiedName(parser) }
  parser.consumeSemicolon()
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams: [], params, returnType,
    body: Block { kind: "block", statements: [], span: parser.span(start) },
    exported, static_: false, isolated_: false, private_: false, bodyless: true,
    native_: true, nativeHeader: headerPath, nativeCppName: cppName, span: parser.span(start),
  }
}

function parseCppQualifiedName(parser: Parser): string {
  let result = parser.text(parser.expect(TokenType.Identifier))
  while parser.match(TokenType.DoubleColon) {
    result = result + "::" + parser.text(parser.expect(TokenType.Identifier))
  }
  return result
}
